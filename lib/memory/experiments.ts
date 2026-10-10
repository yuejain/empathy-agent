import { randomUUID } from 'node:crypto';
import { MemoryRecord, MemoryOrigin, MemoryProfile, TTL } from './schema';
import { rejection, ambiguous, question } from './policy';
import { ExperimentField, experimentFields, ExperimentOperation } from './experiment-schema';

export const experimentLabels:Record<ExperimentField,string> = {hypothesis:'想验证的假设',plan:'具体尝试',measure:'如何观察结果',result:'实际结果',learning:'复盘收获',adjustment:'下一轮调整',values:'在意的价值',constraints:'现实限制',direction:'接下来的方向'};
export function currentCycle(entry:MemoryRecord) { return entry.experiment?.cycles.at(-1); }
export function changeExperiment(entry:MemoryRecord, op:ExperimentOperation, origin:MemoryOrigin, source:'user'|'manual'='manual') {
  if (!['activity','decision'].includes(entry.kind) || !['active','resolved'].includes(entry.status) || entry.expiresAt<=origin.now) throw new Error('请选择有效的行动或决策。');
  if (op.operation==='remove') { delete entry.experiment; return; }
  const previous=currentCycle(entry);
  if (previous?.status==='reviewed' && op.operation!=='iterate' && op.operation!=='save') throw new Error('这一轮已复盘，可修改记录或开始下一轮。');
  if (!entry.experiment) entry.experiment={cycles:[]};
  let cycle=previous;
  if (op.operation==='iterate') {
    if (!previous || previous.status!=='reviewed' || !previous.adjustment) throw new Error('请先记录结果、复盘收获和下一轮调整，再开始下一轮。');
    if (entry.experiment.cycles.length>=8) throw new Error('已保留 8 轮实验，请建立新的行动以继续；旧记录不会被静默丢弃。');
    cycle={id:randomUUID(),createdAt:origin.now,updatedAt:origin.now,status:'draft',hypothesis:previous.hypothesis,measure:previous.measure,plan:previous.adjustment,values:previous.values,constraints:previous.constraints};
    entry.experiment.cycles.push(cycle);
  } else if (!cycle) {
    cycle={id:randomUUID(),createdAt:origin.now,updatedAt:origin.now,status:'draft'};entry.experiment.cycles.push(cycle);
  }
  for(const field of experimentFields) {
    const text=op.fields?.[field];if(text===undefined)continue;
    if((text?.trim()||undefined)===cycle[field]?.text)continue;
    if(cycle.status==='reviewed' && ['hypothesis','plan','measure','result','learning'].includes(field))cycle.status='awaiting_review';
    if(text===null || !text.trim()){delete cycle[field];continue;}
    const reason=rejection(text);if(reason)throw new Error(reason);
    cycle[field]={text:text.trim(),at:origin.now,sessionId:origin.sessionId,turnId:origin.turnId,source};
  }
  if(op.operation==='start') {
    if(!cycle.hypothesis || !cycle.plan || !cycle.measure)throw new Error('开始前请填写假设、具体尝试和观察方式。');
    cycle.status='running';entry.progress='in_progress';entry.status='active';
  } else if(op.operation==='complete') {
    if(!cycle.result)throw new Error('请记录实际结果；完成行动不等于假设得到支持。');
    cycle.status='awaiting_review';entry.progress='completed';entry.status='resolved';
  } else if(op.operation==='review') {
    if(!cycle.result || !cycle.learning)throw new Error('复盘需要实际结果和自己的收获或判断，包括无效、不确定或未完成。');
    cycle.status='reviewed';entry.progress='completed';entry.status='resolved';
  } else if(op.operation==='cancel') {
    cycle.status='cancelled';entry.progress='cancelled';entry.status='resolved';
  } else if(op.operation==='iterate') {entry.progress='planned';entry.status='active';}
  // Editing evidence can invalidate a review, never preserve an unsupported derived status.
  if(cycle.status==='reviewed' && (!cycle.result || !cycle.learning))cycle.status='awaiting_review';
  if(cycle.status==='running' && (!cycle.hypothesis || !cycle.plan || !cycle.measure)) {cycle.status='draft';entry.progress='planned';}
  cycle.updatedAt=origin.now;entry.updatedAt=origin.now;entry.expiresAt=origin.now+TTL[entry.kind];
}
export function syncExperimentProgress(entry:MemoryRecord) {
  const cycle=currentCycle(entry);if(!cycle)return;
  if(entry.progress==='cancelled')cycle.status='cancelled';
  else if(entry.progress==='completed' && cycle.status!=='reviewed')cycle.status='awaiting_review';
  else if(entry.progress==='in_progress')cycle.status=cycle.plan && cycle.hypothesis && cycle.measure ? 'running' : 'draft';
}
export function experimentSummary(entry:MemoryRecord) {
  const cycle=currentCycle(entry);if(!cycle)return undefined;
  return {id:entry.id,title:entry.text,cycle:entry.experiment!.cycles.length,status:cycle.status,reportedAt:cycle.updatedAt,
    fields:Object.fromEntries(experimentFields.filter(k=>cycle[k]).map(k=>[k,cycle[k]!.text])),
    next:cycle.status==='draft'?'补全假设、具体尝试和观察方式':cycle.status==='running'?'按自己的节奏尝试，记录实际观察':cycle.status==='awaiting_review'?'记录结果与复盘收获':cycle.status==='reviewed'?'可收束这一轮，或根据调整开始下一轮':'已撤回，不再催促'};
}
export function experimentPrompt(summaries:NonNullable<ReturnType<typeof experimentSummary>>[],budget=2600) {
  const bounded:unknown[]=[];let used=0;
  for(const item of summaries.slice(0,3)) {
    const fields=Object.fromEntries(Object.entries(item.fields).map(([key,value])=>[key,String(value).slice(0,210)]));
    const candidate={...item,title:item.title.slice(0,150),fields};const size=JSON.stringify(candidate).length;
    if(used+size>budget)continue;used+=size;bounded.push(candidate);
  }
  return ['ACTION_EXPERIMENTS：用户自述的行动实验；假设尚未验证，完成不代表有效。结果不足就保留不确定性。',
    '讨论实验时只补一个当前缺失环节。复盘比较观察方式与实际结果，尊重无效、反效果和放弃；不替用户编造结果或决定。',
    JSON.stringify(bounded)].join('\n');
}

export function updateExperiments(profile:MemoryProfile, updates:{id:string;field:ExperimentField;quote:string}[], input:string, origin:MemoryOrigin) {
  if(!profile.settings.capture)return;
  const groups=new Map<string,Partial<Record<ExperimentField,string>>>();
  for(const update of updates) {
    const tail=input.slice(input.indexOf(update.quote)+update.quote.length);
    if(!input.includes(update.quote) || !experimentEvidence(update.quote) || /^(?:[?？]|吗|么)/.test(tail))continue;
    const fields=groups.get(update.id)||{};fields[update.field]=update.quote;groups.set(update.id,fields);
  }
  for(const [id,fields] of groups) {
    const index=profile.entries.findIndex(e=>e.id===id && e.experiment);if(index<0)continue;
    const copy=structuredClone(profile.entries[index]);
    try {changeExperiment(copy,{operation:'save',fields},origin,'user');}catch{continue;}
    profile.entries[index]=copy;profile.contextEpoch++;profile.revision++;
    profile.audit.push({action:'experiment-evidence',id,at:origin.now});profile.audit=profile.audit.slice(-100);
  }
}

const fieldNames:Record<string,ExperimentField>={假设:'hypothesis',计划:'plan',尝试:'plan',观察方式:'measure',衡量方式:'measure',结果:'result',复盘:'learning',收获:'learning',调整:'adjustment',价值:'values',限制:'constraints',方向:'direction',hypothesis:'hypothesis',plan:'plan',measure:'measure',result:'result',learning:'learning',adjustment:'adjustment',values:'values',constraints:'constraints',direction:'direction'};
// Referring to this experiment's hypothesis is not itself fictional evidence.
function experimentEvidence(text:string) {
  return !rejection(text) && !question(text) && !ambiguous(text.replace(/这个假设|该假设/g,''));
}
export function explicitExperiment(input:string) {
  const lines=input.split(/\n/).map(s=>s.trim()).filter(Boolean);
  const header=lines[0]?.match(/^(?:行动实验|experiment)[：:]\s*(.{2,150})$/i);
  const fields:Partial<Record<ExperimentField,string>>={};
  for(const line of lines.slice(header?1:0)) {
    const match=line.match(/^([^：:]{2,16})[：:]\s*(.+)$/);if(!match)continue;
    const field=fieldNames[match[1].toLowerCase()];if(field && experimentEvidence(match[2]))fields[field]=match[2];
  }
  return {title:header?.[1],fields};
}
