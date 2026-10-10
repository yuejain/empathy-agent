import { StateDecision, SessionState, JourneyStageGuidance } from './types';
import { InteractionIntent } from '../intent/types';

/** Enforce pacing without refusing explicit requests or treating stages as diagnoses. */
export function applyJourneyPolicy(decision:StateDecision,state:SessionState,journey:JourneyStageGuidance,intent:InteractionIntent,input:string):StateDecision {
  if(['SAFETY_PROTOCOL','SESSION_CLOSE','TAROT_ENTRY'].includes(decision.nextState))return decision;
  if(/只想.{0,8}(?:说|倾诉|听)|(?:不要|不用|别|不想).{0,6}(?:建议|办法)|just (?:want|need).{0,30}(?:listen|vent)|(?:no|don't|do not|without).{0,12}advice/i.test(input))return {...decision,nextState:'EMPATHY_PHASE',empathyLevel:'L2',constraints:{empathyOnly:true,noActionQuestions:true},reason:'本轮明确倾诉意愿',shouldProgress:false};
  if(decision.nextState==='REVIEW_PHASE' && /已经完成|做完了|finished|completed|复盘|回顾|review/i.test(input))return decision;
  const explicitAction=/下一步|怎么做|建议|愿意试试|what should|next step|advice|willing to try/i.test(input);
  const explicitExplore=/一起梳理|继续梳理|想弄清|想理解|想了解|帮我分析|help me understand|explore|make sense/i.test(input);
  const recent=state.recentHistory.filter(t=>t.role==='user');let depth=0;
  for(let i=recent.length-1;i>=0 && recent[i].state==='EXPLORE_PHASE';i--)depth++;
  if(intent==='L2.4_review_request')return {...decision,nextState:'REVIEW_PHASE',empathyLevel:'L4',constraints:{},reason:'本轮复盘意图',shouldProgress:true};
  if(intent==='L2.1_emotional_venting' && !explicitAction && !explicitExplore)return {...decision,nextState:'EMPATHY_PHASE',empathyLevel:'L2',constraints:{empathyOnly:true,noActionQuestions:true},reason:'尊重倾诉意图',shouldProgress:false};
  if(decision.constraints.empathyOnly && !explicitAction && !explicitExplore)return decision;
  if(explicitAction || intent==='L2.3_action_discussion' || intent==='L2.5_advice_seeking')return {...decision,nextState:'ACTION_PHASE',empathyLevel:'L5',constraints:{},reason:'用户行动意图',shouldProgress:true};
  if(explicitExplore)return {...decision,nextState:'EXPLORE_PHASE',empathyLevel:'L3',constraints:{},reason:'用户明确探索意图',shouldProgress:true};
  if(decision.nextState==='EXPLORE_PHASE' && (depth>=journey.maxExploreDepth || journey.avoidStates.includes('EXPLORE_PHASE')) || decision.nextState==='ACTION_PHASE' && journey.avoidStates.includes('ACTION_PHASE'))
    return {...decision,nextState:'EMPATHY_PHASE',empathyLevel:'L2',constraints:{noProgression:true,noActionQuestions:true},reason:'达到当前旅程探索深度，先承接与整理',shouldProgress:false};
  return decision;
}
