import type { MemoryProfile } from '../memory/schema';
import { ambiguous, question, rejection } from '../memory/policy';
import { Appraisal, AppraisalSignal, AffectVector, AffectState, appraisalSchema } from './schema';

// These are design parameters for a functional simulation, not measured feelings.
export const baseline:AffectVector={valence:.12,arousal:.22,warmth:.60,concern:.12,curiosity:.35};
const keys=Object.keys(baseline) as (keyof AffectVector)[];
const HOUR=3600000;
const targets:Record<AppraisalSignal,AffectVector>={
  progress:{valence:.65,arousal:.40,warmth:.72,concern:.10,curiosity:.45},
  setback:{valence:-.25,arousal:.30,warmth:.72,concern:.64,curiosity:.35},
  distress:{valence:-.35,arousal:.38,warmth:.78,concern:.85,curiosity:.18},
  relief:{valence:.48,arousal:.18,warmth:.70,concern:.08,curiosity:.32},
  discovery:{valence:.35,arousal:.45,warmth:.62,concern:.10,curiosity:.90},
  correction:{valence:-.08,arousal:.20,warmth:.64,concern:.30,curiosity:.65},
  boundary:{valence:.08,arousal:.12,warmth:.60,concern:.10,curiosity:.15},
  appreciation:{valence:.35,arousal:.25,warmth:.72,concern:.10,curiosity:.35},
};
export const signalLabels:Record<AppraisalSignal,string>={progress:'有了进展',setback:'遇到挫折',distress:'表达困扰',relief:'有所缓解',discovery:'探索新理解',correction:'纠正理解',boundary:'表达边界',appreciation:'表达感谢'};
const mix=(a:AffectVector,b:AffectVector,weight:number):AffectVector=>Object.fromEntries(keys.map(k=>[k,Number((a[k]+(b[k]-a[k])*weight).toFixed(5))])) as AffectVector;
function initial(epoch:number,now:number):AffectState {return {epoch,updatedAt:now,turns:0,feeling:{...baseline},mood:{...baseline},events:[]};}
function current(profile:MemoryProfile,now:number):AffectState {
  const saved=profile.affect?.state;
  if(profile.affect?.enabled===false || !profile.settings.capture || !profile.settings.recall || !saved)return initial(profile.contextEpoch,now);
  const elapsed=Math.max(0,now-saved.updatedAt);
  return {...structuredClone(saved),updatedAt:now,
    feeling:mix(baseline,saved.feeling,Math.exp(-elapsed/(2*HOUR))),
    mood:mix(baseline,saved.mood,Math.exp(-elapsed/(7*24*HOUR))),
    events:elapsed>24*HOUR?[]:saved.events};
}
function factualSpan(input:string,quote:string,explicitBoundary=false) {
  if(rejection(input,2000) || ambiguous(input) || /如果|要是|\bif\b|\bmight\b/i.test(input) || !input.includes(quote) || rejection(quote) || question(quote) || /^(?:请|你能|你可以|please\b|can you\b|could you\b)/i.test(quote))return false;
  const at=input.indexOf(quote),tail=input.slice(at+quote.length);
  // A model cannot turn the middle of a negated, conditional or interrogative clause into evidence.
  const clause=input.slice(0,at).split(/[。.!?？；;\n]/).at(-1)||'';
  const ending=tail.match(/^[^。.!?？；;\n]*(?:[。.!?？；;\n]|$)/)?.[0]||'';
  // A polite explicit boundary ("不要建议，好吗？") is still a request to respect,
  // whereas a prefix such as "I finished" inside "I finished the task?" is not a report.
  return (explicitBoundary || !question(clause+quote+ending)) && !/(?:不|没|未|并非|不是|如果|要是|可能|\bnot\b|\bnever\b|\bif\b|\bmight\b)[^。.!?？；;\n]*$/i.test(clause);
}
export function acceptedAppraisals(input:string,raw:unknown):Appraisal[] {
  if(!Array.isArray(raw))return [];
  const out:Appraisal[]=[];
  for(const item of raw.slice(0,8)) {
    const p=appraisalSchema.safeParse(item);if(!p.success || p.data.confidence<.65 || !factualSpan(input,p.data.quote) || out.some(e=>e.signal===p.data.signal))continue;
    if(p.data.signal==='correction' && !/纠正|误解|理解错|说错|错了|不对|不是.{0,6}意思|忽略.{0,8}(?:重点|意思)|wrong|misunderstood|incorrect|not what I meant/i.test(p.data.quote))continue;
    out.push(p.data);if(out.length===3)break;
  }
  return out;
}
const rules:[AppraisalSignal,RegExp][]=[
  ['boundary',/不想继续|先聊到这|(?:不要|不用)(?:给我?|提)?建议|只想倾诉|让我静静|不想聊|(?:don't|do not) want (?:advice|to talk)|just (?:listen|let me vent)|let's stop/i],
  ['correction',/你(?:理解错了|误解了|没理解)|不是这个意思|you misunderstood|that's not what I meant/i],
  ['relief',/我(?:现在|已经|感觉)?(?:好多了|好一些了|安心了|轻松了)|I (?:feel better|am relieved)|I'm relieved/i],
  ['setback',/没有改善|没能完成|没有成功|我失败了|仍然很难|did(?:n't| not) (?:help|work)|no improvement|I failed/i],
  ['distress',/我(?:现在|今天|真的|感到|感觉|很|特别|有点)*(?:难过|焦虑|害怕|孤独|疲惫)|I (?:feel|am) (?:sad|anxious|afraid|lonely|exhausted)/i],
  ['progress',/我(?:终于|已经)?(?:完成了|做到了|成功了)|I (?:finally )?(?:finished|succeeded|did it)/i],
  ['discovery',/我(?:发现|意识到|明白了|想探索|想弄清)|I (?:realized|discovered|want to explore)/i],
  ['appreciation',/谢谢你|感谢你|thank you|thanks for/i],
];
function localAppraisals(input:string):Appraisal[] {
  const output:Appraisal[]=[];
  for(const [signal,pattern] of rules){const match=input.match(pattern);if(match && factualSpan(input,match[0],signal==='boundary'))output.push({signal,quote:match[0],confidence:.8});}
  return output;
}
export function advanceAffect(profile:MemoryProfile,input:string,appraisals:unknown,now=Date.now()) {
  const before=current(profile,now);
  if(profile.affect?.enabled===false)return affectView(profile,now);
  const local=localAppraisals(input),merged=acceptedAppraisals(input,appraisals);
  // Explicit correction, stopping and negative outcomes take precedence over model interpretation.
  const priority=local.filter(e=>['boundary','correction','setback','distress'].includes(e.signal));
  const selected=[...priority,...merged,...local].filter((e,i,all)=>all.findIndex(x=>x.signal===e.signal)===i).slice(0,3);
  const evidence=selected.some(e=>['distress','setback'].includes(e.signal))?selected.filter(e=>!['progress','appreciation'].includes(e.signal)):selected;
  let target={...baseline};
  if(evidence.length) {
    const total=evidence.reduce((sum,e)=>sum+e.confidence,0);
    target=Object.fromEntries(keys.map(k=>[k,evidence.reduce((sum,e)=>sum+targets[e.signal][k]*e.confidence,0)/total])) as AffectVector;
  }
  const state:AffectState={...before,epoch:profile.contextEpoch,turns:Math.min(Number.MAX_SAFE_INTEGER,before.turns+1),updatedAt:now,
    feeling:mix(before.feeling,target,evidence.length?.45:.16),mood:mix(before.mood,target,evidence.length?.08:.025),
    events:evidence.map(e=>({signal:e.signal,confidence:e.confidence,source:local.includes(e)?'local':'merged'}))};
  if(profile.settings.capture && profile.settings.recall) {
    profile.affect={enabled:true,state};profile.revision++;
  }
  return affectView(profile,now,state);
}
export type AffectDeliveryMode='space'|'repair'|'support'|'relief'|'encourage'|'explore'|'steady';
const tones:Record<AffectDeliveryMode,string>={space:'尊重空间',repair:'认真校准',support:'关切',relief:'欣慰',encourage:'欣慰',explore:'好奇',steady:'平和'};
export function affectDelivery(state:AffectState) {
  const has=(signal:AppraisalSignal)=>state.events.some(e=>e.signal===signal),f=state.feeling,m=state.mood;
  // An explicit event is authoritative for this turn, even when the fast vector still
  // carries yesterday's joy or worry. Slow mood may color delivery, never reinterpret it.
  const mode:AffectDeliveryMode=has('boundary')?'space':has('correction')?'repair':has('setback') || has('distress')?'support':
    has('relief')?'relief':has('progress')?'encourage':has('discovery')?'explore':has('appreciation')?'steady':
    f.concern>.32?'support':f.curiosity>.51?'explore':f.valence>.26?'encourage':'steady';
  let pace:'unhurried'|'steady'|'light'=m.concern>.28 || (m.arousal<.18 && f.arousal<.25)?'unhurried':
    m.arousal>.30 && f.arousal>.32 && m.valence>.18?'light':'steady';
  let warmth:'gentle'|'warm'=m.warmth>.66?'warm':'gentle';
  const followUp=mode==='space' || mode==='repair'?'none' as const:'optional' as const;
  if(mode==='space'){pace='unhurried';warmth='gentle';}
  if(mode==='repair'){pace='steady';warmth='gentle';}
  if(mode==='support'){pace='unhurried';warmth='warm';}
  if(mode==='relief' && pace==='light')pace='steady';
  return {mode,pace,warmth,followUp,basis:state.events.length?'current-event' as const:'state' as const};
}
export function affectView(profile:MemoryProfile,now=Date.now(),transient?:AffectState) {
  const enabled=profile.affect?.enabled!==false,persistent=profile.settings.capture && profile.settings.recall;
  const state=transient||current(profile,now),f=state.feeling;
  const delivery=affectDelivery(state);
  return {enabled,simulation:true as const,persistence:persistent?'cross-session' as const:'turn-only' as const,
    tone:enabled?tones[delivery.mode]:'已关闭',delivery,feeling:f,mood:state.mood,turns:state.turns,
    events:state.events.map(e=>({...e,label:signalLabels[e.signal]})),updatedAt:state.turns?state.updatedAt:null};
}
export type AffectView=ReturnType<typeof affectView>;
export function affectPrompt(view:AffectView):string {
  if(!view.enabled)return '';
  const {mode,pace,warmth,followUp}=view.delivery;
  const delivery:Record<AffectDeliveryMode,string>={
    space:'当前边界优先：尊重停止、独处或只倾诉的选择，简短回应，不追问、不追加建议或任务，不表达被抛弃或受伤。',
    repair:'当前纠正优先：先修正已知误解、撤回不成立的推断，不辩解，不用追问绕过纠正，也不向用户索取安慰。',
    support:'当前困难或负面结果优先：承认无效、反效果或不确定，先关照眼前困难，不用旧进展或乐观心境冲淡它，不强推下一次尝试。',
    relief:'回应用户此刻报告的缓解：可以欣慰，但只认可这次变化，不宣布问题已解决，也不让残留担忧否定当前改善。',
    encourage:'如当前原话或有效历史确有进展，可具体肯定；惯性中的欣慰不是新的成功证据，不夸大效果或替用户宣布成功。',
    explore:'可以表达对新理解的兴趣，跟随用户的问题；探索兴趣不代表存在新发现，不自行升级分析深度。',
    steady:'平和、温暖地回应当前内容，避免重复情感套话；心境不能成为新事实或新话题。',
  };
  if(view.delivery.basis==='state' && mode==='support')delivery.support='残留的关切只调节表达，不推断用户仍在困难中。以本轮内容为准，不重提已失效的负面经历，也不替用户判断效果。';
  const rhythm=pace==='unhurried'?'节奏放缓，用短段落承接，不催促立即行动。':pace==='light'?'节奏可以稍轻快、语言简洁，不增加兴奋感叹或承诺。':'节奏平稳，直接回应，避免拉长铺垫。';
  const temperature=warmth==='warm'?'温度可更明显，但关切应落在用户已说的具体处境上，不夸大亲密关系。':'保持温和克制，少用修饰，不因低活跃或拒绝而冷淡。';
  return ['ASSISTANT_AFFECT：以下是助手自身的计算性情感状态，不是用户情绪标签，也不是已证实的主观体验。',
    JSON.stringify({tone:view.tone,delivery:view.delivery,feeling:view.feeling,mood:view.mood,events:view.events.map(e=>e.signal)}),delivery[mode],
    `表达节奏与温度由快反应和慢心境共同调节：${rhythm}${temperature}${followUp==='none'?'本轮不追问。':'只有用户愿意时才推进，一次最多一个问题；不需要为保持对话而提问。'}`,
    '让状态自然影响语气与关注点，不照读数值、不抢走用户话题。事件标签只是计算线索，不可据此编造刚才发生了什么；事实必须来自当前原话或有效历史。',
    '可以自然表达关切、欣慰或兴趣；被问到机制时，明确数值由应用中的外部情感模块更新，再作为上下文传给语言模型，不是模型已被改造出内在感受或自省能力。区分情感模拟与尚有争议的主观体验，不声称已获得意识，也不把此争议说成已解决。',
    '自身状态不得覆盖事实、用户自主选择、交流约束或安全支持。用户离开、拒绝、删除记忆或选择现实关系不会伤害你，不索取照顾，不制造内疚、依赖、嫉妒或排他关系。'].join('\n');
}
