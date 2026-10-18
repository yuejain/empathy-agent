import { MemoryProfile, MemoryRecord, eligible, retrieveMemories } from '../memory';
import { rejection } from '../memory/policy';
import { Turn } from '../orchestrator/types';
import { MAX_PRIVATE_MEMORY_CANDIDATES } from '../local-knowledge';

export function boundedHistory(history:Turn[], epoch:number, now=Date.now(), budget=6000) {
  const valid=history.filter(t => { const age=now-Date.parse(t.timestamp); return t.memoryEpoch===epoch && age>=0 && age<3600000; });
  const selected:Turn[]=[];let size=0;
  for(let i=valid.length-1;i>=1;i-=2){const pair=valid.slice(i-1,i+1),length=pair.reduce((n,t)=>n+t.content.length,0);if(size+length>budget)break;selected.unshift(...pair);size+=length;}
  return selected;
}

export function retrievalRequest(input: string, profile: MemoryProfile, history: Turn[], now = Date.now()) {
  const memories = profile.settings.recall ? profile.entries.filter(e => eligible(e, now)) : [];
  const ranked = retrieveMemories(profile, input, now, 12000);
  const seen = new Set<string>();
  // The profile is already bounded to 300 records. Do not discard older semantic matches
  // before the local encoder can score them; the final cloud prompt stays independently bounded.
  const candidates = [...ranked, ...memories.sort((a,b) => b.updatedAt - a.updatedAt)]
    .filter(e => { if (seen.has(e.id)) return false; seen.add(e.id); return true; })
    .slice(0, MAX_PRIVATE_MEMORY_CANDIDATES);
  // Resolve follow-on wording using user-authored context only; never use assistant or corpus text.
  const followOn = /^(?:那|这|它|继续|然后|还是|上次|之前|最近怎么样|that\b|it\b|and\b|still\b|continue\b|what about\b)/i.test(input.trim());
  const correcting = /更正|改为|改去|忘记|删除|不再|不是|instead|correct|forget|no longer/i.test(input);
  const previous = history.filter(t => t.role === 'user' && t.content.length >= 6 && !rejection(t.content,2000)
    && !/^(?:请)?(?:记住|忘记|直接一点|简短一点|详细一点|温柔一点|别总问问题|不要总问问题|我选[ABC]|remember:|be direct|be brief|stop asking questions)/i.test(t.content)).at(-1)?.content;
  const anchor = previous || ranked.find(e => e.kind === 'activity' || e.kind === 'decision')?.text;
  const expanded = followOn && !correcting && anchor ? `${input}\n用户此前提到：${anchor.slice(0,300)}` : input;
  return { text: input, query: expanded.slice(0,2600), expanded: expanded !== input,
    memories: candidates.map(({id,text}) => ({id,text})), candidateIds: new Set(candidates.map(e => e.id)) };
}
export function validSemanticScores(hits: {id:string;score:number}[] = [], candidates: Set<string>, entries: MemoryRecord[], now = Date.now()) {
  const valid = new Set(entries.filter(e => eligible(e, now)).map(e => e.id));
  return new Map(hits.filter(h => candidates.has(h.id) && valid.has(h.id)).map(h => [h.id,h.score]));
}
