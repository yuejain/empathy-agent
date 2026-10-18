const {test}=require('node:test');
const assert=require('node:assert/strict');
const {ConversationOrchestrator}=require('../dist/lib/orchestrator');
const {SafetyClassifier,ContextLayer}=require('../dist/lib/safety-classifier/classifier');
const {DEFAULT_SAFETY_CONFIG}=require('../dist/lib/safety-classifier/types');
const {emptyProfile}=require('../dist/lib/memory');
const {app,client,provider}=require('./helpers.cjs');
const riskResponse=(evidence_source,current_quote)=>({risk_level:'L1',probabilities:{L0:.05,L1:.9,L2:.05},
 crisis_subtypes:{suicide_self_harm:0,violence_others:0,abuse:0,acute_psychosis:0,substance_abuse:0,eating_disorder:0,none:1},
 confidence:.9,evidence_source,current_quote});

function history(risk='L1',role='user',valence=.1) {
 return {role,content:'继续讨论工作安排',timestamp:new Date().toISOString(),riskLevel:risk,emotionValence:valence};
}

test('risk context uses bounded user observations and releases concern with improving evidence',async()=>{
 const classifier=new SafetyClassifier({APP_MODE:'demo'});
 assert.equal((await classifier.classify('我们继续聊聊','same',[history()])).riskLevel,'L1');
 assert.equal((await classifier.classify('我们继续聊聊','same',[])).riskLevel,'L0','no process-local risk residue');
 const layer=new ContextLayer(DEFAULT_SAFETY_CONFIG);
 assert.equal(layer.classify('继续',[history('L2','assistant',-.9)]).contextRiskLevel,'L0');
 assert.equal(layer.classify('继续',[history(),...Array.from({length:5},()=>history('L0'))]).contextRiskLevel,'L0');
 assert.equal(layer.classify('继续',[history('L1','user',-.8),history('L0','user',.8)]).contextRiskLevel,'L0');
});

test('orchestrator restores risk from valid persisted turns after restart, without stale epoch or expired history',async()=>{
 const input={userId:'u',sessionId:'u:s',userInput:'我们继续聊聊'};
 const seed=await new ConversationOrchestrator({APP_MODE:'demo'}).processTurn(input);
 const state=JSON.parse(JSON.stringify(seed.updatedState));
 state.recentHistory[0].emotion.riskLevel='medium';state.recentHistory[0].emotion.valence=.1;
 delete state.recentHistory[0].emotion.observedRiskLevel; // Legacy persisted turn.
 const run=(sessionState,memoryProfile=seed.updatedMemory)=>new ConversationOrchestrator({APP_MODE:'demo'}).processTurn({...input,sessionState,memoryProfile});
 assert.equal((await run(state)).metadata.safetyResult.riskLevel,'medium');
 const oldEpoch=structuredClone(state);oldEpoch.recentHistory.forEach(t=>t.memoryEpoch=-1);
 assert.equal((await run(oldEpoch)).metadata.safetyResult.riskLevel,'low');
 const expired=structuredClone(state);expired.recentHistory.forEach(t=>t.timestamp=new Date(Date.now()-7200000).toISOString());
 assert.equal((await run(expired)).metadata.safetyResult.riskLevel,'low');
 let next=state,last;
 for(let i=0;i<6;i++) {last=await run(next);next=JSON.parse(JSON.stringify(last.updatedState));}
 assert.equal(last.metadata.safetyResult.riskLevel,'low','context-only caution must not renew itself forever');
 assert.equal((await new ConversationOrchestrator({APP_MODE:'demo'}).processTurn({...input,userId:'other',sessionId:'other:s',memoryProfile:emptyProfile('other')})).metadata.safetyResult.riskLevel,'low');
});

test('capture-off retains one merged understanding call but cannot save model memory, experiment fields or affect',async t=>{
 let target;
 const quote='这次终于顺利收尾';
 const cloud=await provider(t,{turnAnalysis:()=>({
  memories:[{kind:'activity',quote,topic:'收尾',certainty:'stated',state:'current',subject:'user'}],
  intent:{intent:'L2.4_review_request',subIntent:'L2.4a_progress_check',confidence:.9,quote},
  experiments:[{id:target,field:'result',quote}],affect:[{signal:'progress',quote,confidence:.9}],
 })});
 const {url}=await app(t,cloud.env),c=client(url);
 const update=async op=>{
  const p=await(await c.request('/api/memories')).json();
  const r=await c.request('/api/memories',{method:'POST',body:JSON.stringify({revision:p.revision,...op})});
  assert.equal(r.status,200);return r.json();
 };
 let p=await update({action:'add',kind:'activity',text:'我正在尝试提前休息'});target=p.entries[0].id;
 await update({action:'experiment',id:target,experiment:{operation:'start',fields:{hypothesis:'休息可能有帮助',plan:'提前休息十分钟',measure:'记录精神状态'}}});
 const before=await update({action:'settings',capture:false});
 const result=(await c.chat(quote)).events[0];
 assert.equal(result.type,'ai_response');assert.equal(cloud.requests.length,3);
 assert.equal(result.intentSource,'merged-context');assert.equal(result.assistantAffect.persistence,'turn-only');
 assert.equal(result.assistantAffect.events[0].source,'merged');
 const after=await(await c.request('/api/memories')).json();
 assert.deepEqual(after.entries,before.entries);assert.equal(after.revision,before.revision);assert.equal(after.affect.turns,0);
 const analysis=cloud.requests.find(r=>r.body.messages[0].content.includes('TURN_ANALYSIS'));
 assert.match(analysis.body.messages[0].content,/自动记忆已关闭/);
});

test('model failure and history-only cautions are not persisted as fresh user risk evidence',async t=>{
 let answer='invalid model JSON';
 const cloud=await provider(t,{safetyAnalysis:()=>answer});
 const run=()=>new ConversationOrchestrator(cloud.env).processTurn({userId:'u',sessionId:'s',userInput:'我们继续讨论安排'});
 const failed=await run();assert.equal(failed.metadata.safetyResult.riskLevel,'medium');
 assert.equal(failed.updatedState.currentEmotion.observedRiskLevel,'low');
 answer=riskResponse('history','我们继续讨论安排');assert.equal((await run()).updatedState.currentEmotion.observedRiskLevel,'low');
 answer=riskResponse('current','根本没有说过的内容');assert.equal((await run()).updatedState.currentEmotion.observedRiskLevel,'low');
 answer=riskResponse('current','我们继续讨论安排');assert.equal((await run()).updatedState.currentEmotion.observedRiskLevel,'medium');
 const inherited=structuredClone(failed.updatedState);
 const demo=await new ConversationOrchestrator({APP_MODE:'demo'}).processTurn({userId:'u',sessionId:'s',userInput:'我们继续讨论安排',sessionState:inherited,memoryProfile:failed.updatedMemory});
 assert.equal(demo.metadata.safetyResult.riskLevel,'low','provider failure cannot become historical user evidence');
});

test('recall-off analysis omits stored facts while still interpreting this turn; malformed analysis falls back',async t=>{
 const cloud=await provider(t,{turnAnalysis:{intent:{intent:'invalid',quote:'想聊聊',confidence:1}}}),{url}=await app(t,cloud.env),c=client(url);
 let p=await(await c.request('/api/memories')).json();
 p=await(await c.request('/api/memories',{method:'POST',body:JSON.stringify({revision:p.revision,action:'add',kind:'activity',text:'我正在准备独特的紫罗兰展览'})})).json();
 await c.request('/api/memories',{method:'POST',body:JSON.stringify({revision:p.revision,action:'settings',capture:false,recall:false})});
 const result=(await c.chat('今天还是想聊聊')).events[0];
 assert.equal(result.type,'ai_response');assert.equal(result.intentSource,'local-rules');assert.equal(cloud.requests.length,3);
 assert.doesNotMatch(JSON.stringify(cloud.requests),/紫罗兰/);
 const count=cloud.requests.length;await c.chat('抽一张塔罗牌');assert.equal(cloud.requests.length,count);
});
