import { createHash, randomUUID } from 'node:crypto';
import { MemoryRecord, MemoryOrigin, MemoryProfile, TTL } from './schema';
import { rejection, ambiguous, question } from './policy';
import { ExperimentCycle, ExperimentField, experimentFields, ExperimentOperation } from './experiment-schema';

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
type ExperimentEvidence=NonNullable<ExperimentCycle[ExperimentField]>;
const evidenceVersion=(evidence:ExperimentEvidence)=>createHash('sha256').update(JSON.stringify([
  evidence.text,evidence.at,evidence.sessionId,evidence.turnId,evidence.source,
])).digest('hex').slice(0,16);
const fieldId=(entryId:string,cycleId:string,field:ExperimentField)=>`${entryId}/${cycleId}/${field}`;

// Rebuild provenance from the surviving records, never from a cached narrative. Iteration
// carries only these fields forward; identical text from another report is not inheritance.
function fieldSource(entry:MemoryRecord,cycles:ExperimentCycle[],versions:Partial<Record<ExperimentField,string>>[],index:number,field:ExperimentField) {
  const evidence=cycles[index][field]!,version=versions[index][field]!;
  let sourceIndex=index,sourceField=field;
  while(sourceIndex>0) {
    const inheritedField=sourceField==='plan'?'adjustment':(['hypothesis','measure','values','constraints'].includes(sourceField)?sourceField:undefined);
    if(!inheritedField)break;
    const previous=cycles[sourceIndex-1][inheritedField];
    if(!previous || versions[sourceIndex-1][inheritedField]!==version)break;
    sourceIndex--;sourceField=inheritedField;
  }
  return {fieldId:fieldId(entry.id,cycles[index].id,field),sourceId:fieldId(entry.id,cycles[sourceIndex].id,sourceField),
    version,cycleId:cycles[sourceIndex].id,field:sourceField,at:evidence.at,sessionId:evidence.sessionId,turnId:evidence.turnId,source:evidence.source};
}
export function experimentSummary(entry:MemoryRecord) {
  const cycle=currentCycle(entry);if(!cycle)return undefined;
  const cycles=entry.experiment!.cycles;
  const versions=cycles.map(round=>Object.fromEntries(experimentFields.filter(k=>round[k]).map(k=>[k,evidenceVersion(round[k]!)])));
  const rounds=cycles.map((round,index)=>({cycle:index+1,cycleId:round.id,status:round.status,reportedAt:round.updatedAt,
    fields:Object.fromEntries(experimentFields.filter(k=>round[k]).map(k=>[k,round[k]!.text])) as Partial<Record<ExperimentField,string>>,
    sources:Object.fromEntries(experimentFields.filter(k=>round[k]).map(k=>[k,fieldSource(entry,cycles,versions,index,k)])) as Partial<Record<ExperimentField,ReturnType<typeof fieldSource>>>,
  }));
  const latest=rounds[rounds.length-1];
  return {id:entry.id,title:entry.text,cycle:cycles.length,status:cycle.status,reportedAt:cycle.updatedAt,
    fields:latest.fields,sources:latest.sources,rounds,
    next:cycle.status==='draft'?'补全假设、具体尝试和观察方式':cycle.status==='running'?'按自己的节奏尝试，记录实际观察':cycle.status==='awaiting_review'?'记录结果与复盘收获':cycle.status==='reviewed'?'可收束这一轮，或根据调整开始下一轮':'已撤回，不再催促'};
}
type ExperimentSummary=NonNullable<ReturnType<typeof experimentSummary>>;
type PromptRound={cycle:number;cycleId:string;status:ExperimentCycle['status'];reportedAt:number;
  fields:Partial<Record<ExperimentField,{quote:string;version:string;from?:{cycleId:string;field:ExperimentField}}>>;omittedFields:ExperimentField[]};
type PromptExperiment={id:string;title:string;currentCycle:number;next:string;rounds:PromptRound[];omittedCycles:number};
const comparisonFields:ExperimentField[]=['plan','result','measure','learning','adjustment','hypothesis','values','constraints','direction'];
const experimentInstructions=[
  'ACTION_EXPERIMENTS：用户自述的历轮实验，非效果或因果证明；假设待验证，完成不代表有效。',
  '按轮对照尝试、观察方式、结果和调整，只引用所给原话。区分已尝试与下一轮计划，保留无效、反效果、不确定及放弃；只补一个缺失环节，不替用户决定。',
  '字段ID=id/cycleId/字段名；version标识该证据版本，from仅指继承的源字段。省略的字段或轮次未知，不补全；记录时间不是执行时间。',
].join('\n')+'\n';
export function experimentPrompt(summaries:ExperimentSummary[],budget=2600) {
  // Budget is the entire returned string in UTF-16 code units, including instructions,
  // separators and JSON. Never truncate a quote: a final negation can reverse its meaning.
  const limit=Number.isFinite(budget)?Math.max(0,Math.floor(budget)):0;
  const experiments:PromptExperiment[]=[];
  const render=()=>experimentInstructions+JSON.stringify({experiments,omittedExperiments:summaries.length-experiments.length});
  if(!summaries.length || render().length>limit)return '';
  for(const item of summaries.slice(0,3)) {
    const latest=item.rounds.at(-1);if(!latest)continue;
    const shell=(round:typeof latest):PromptRound=>({cycle:round.cycle,cycleId:round.cycleId,status:round.status,reportedAt:round.reportedAt,
      fields:{},omittedFields:experimentFields.filter(field=>round.fields[field]!==undefined)});
    const packed:PromptExperiment={id:item.id,title:item.title,currentCycle:item.cycle,next:item.next,rounds:[shell(latest)],omittedCycles:item.rounds.length-1};
    experiments.push(packed);
    if(render().length>limit){experiments.pop();continue;}
    const addField=(round:typeof latest,field:ExperimentField)=>{
      const quote=round.fields[field],source=round.sources[field];if(quote===undefined || !source)return;
      let target=packed.rounds.find(r=>r.cycleId===round.cycleId);
      const addedRound=!target;
      if(!target){target=shell(round);packed.rounds.push(target);packed.rounds.sort((a,b)=>a.cycle-b.cycle);packed.omittedCycles--;}
      target.fields[field]={quote,version:source.version,...(source.fieldId!==source.sourceId?{from:{cycleId:source.cycleId,field:source.field}}:{})};
      target.omittedFields=target.omittedFields.filter(f=>f!==field);
      if(render().length>limit) {
        delete target.fields[field];target.omittedFields=experimentFields.filter(f=>round.fields[f]!==undefined && !target!.fields[f]);
        if(addedRound){packed.rounds=packed.rounds.filter(r=>r!==target);packed.omittedCycles++;}
      }
    };
    // Pair the current attempt with its predecessor before spending space on older rounds.
    const recent=item.rounds.slice(-2).reverse();
    for(const field of comparisonFields)for(const round of recent)addField(round,field);
    for(const round of item.rounds.slice(0,-2).reverse())for(const field of comparisonFields)addField(round,field);
  }
  return experiments.length?render():'';
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
