import { SessionState, OrchestratorConfig, DEFAULT_ORCHESTRATOR_CONFIG } from './types';
export function sessionHealth(state?:SessionState,config:OrchestratorConfig=DEFAULT_ORCHESTRATOR_CONFIG,now=Date.now()) {
  if(!state)return {status:'not_found',message:''};
  if(state.currentState==='SAFETY_PROTOCOL')return {status:'safety_support',message:''};
  if(state.currentState==='SESSION_CLOSE')return {status:'closed',message:'这段对话已经告一段落。可以开始新对话，长期记忆会保留。'};
  const checkpoint=state.healthCheckpoint;
  const elapsed=now-Date.parse(checkpoint?.at||state.startedAt), turns=state.turnCount-(checkpoint?.turnCount||0);
  if(now-Date.parse(state.lastActiveAt||state.startedAt)>config.inactivityTimeout*1000)return {status:'timeout',message:'离上次交流已有一段时间。可以接着聊，也可以从新的话题开始。'};
  if(elapsed>=config.sessionMaxDuration*1000)return {status:'duration_limit',message:'已经聊了一段时间。要不要先休息一下，或整理后开始新对话？'};
  if(turns>=config.maxTurnsPerSession)return {status:'turn_limit',message:'这段对话已经积累了不少内容。可以开启新对话，也可以按你的节奏继续。'};
  return {status:'healthy',message:''};
}
