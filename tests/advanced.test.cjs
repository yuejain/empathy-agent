const {test}=require('node:test');
const assert=require('node:assert/strict');
const {emptyProfile,prepareMemory,mutateMemory,profileSchema}=require('../dist/lib/memory');
const {updateExperiments,currentCycle}=require('../dist/lib/memory/experiments');
const {continuityView}=require('../dist/lib/context/continuity');
const {sessionHealth}=require('../dist/lib/orchestrator/session-health');
const {applyJourneyPolicy}=require('../dist/lib/orchestrator/journey-policy');
const {ConversationOrchestrator}=require('../dist/lib/orchestrator');
const {SessionStore}=require('../dist/server/session-store');
const {app,client,provider}=require('./helpers.cjs');
const origin=()=>({sessionId:'fixture',turnId:'manual',now:Date.now()});
const mutate=(p,op)=>mutateMemory(p,{revision:p.revision,...op},origin());
const base=()=>prepareMemory(emptyProfile('u'),'我正在尝试午休散步',origin()).profile;
const change=(p,operation,fields)=>mutate(p,{action:'experiment',id:p.entries[0].id,experiment:{operation,fields}});
const plan={hypothesis:'午休散步可能让我下午更清醒',plan:'午饭后散步十分钟',measure:'连续三天记录下午困倦程度'};

test('experiment cycle requires evidence, preserves negative results and supports reviewed iteration',()=>{
 let p=base();assert.throws(()=>change(p,'start',{}),/假设/);assert.equal(p.entries[0].experiment,undefined);
 p=change(p,'start',plan);assert.equal(currentCycle(p.entries[0]).status,'running');
 assert.throws(()=>change(p,'complete'),/实际结果/);
 p=change(p,'complete',{result:'三天都没有感觉更清醒'});assert.equal(p.entries[0].status,'resolved');assert.equal(currentCycle(p.entries[0]).status,'awaiting_review');
 assert.throws(()=>change(p,'review'),/复盘/);
 p=change(p,'review',{learning:'目前没有支持假设的证据',adjustment:'下一轮提前半小时睡觉',direction:'先保证充足睡眠'});
 assert.equal(continuityView(p).journey.stage,'journey_stage_4');
 const first=currentCycle(p.entries[0]).id;p=change(p,'iterate');
 assert.equal(p.entries[0].experiment.cycles.length,2);assert.notEqual(currentCycle(p.entries[0]).id,first);assert.equal(currentCycle(p.entries[0]).result,undefined);
 assert.equal(currentCycle(p.entries[0]).plan.text,'下一轮提前半小时睡觉');assert.equal(p.entries[0].status,'active');
 assert.equal(profileSchema.safeParse(p).success,true);
});
test('correction invalidates derived direction; removal and recall-off erase experiment context',()=>{
 let p=change(base(),'review',{...plan,result:'有一点帮助',learning:'需要再观察',direction:'坚持散步'});
 p=change(p,'save',{result:'更正：实际没有改善'});assert.equal(currentCycle(p.entries[0]).status,'awaiting_review');assert.notEqual(continuityView(p).journey.stage,'journey_stage_4');
 const epoch=p.contextEpoch;p=mutate(p,{action:'settings',recall:false});assert.deepEqual(continuityView(p).experiments,[]);assert.ok(p.contextEpoch>epoch);
 p=mutate(p,{action:'delete',id:p.entries[0].id});assert.doesNotMatch(JSON.stringify(p),/散步|没有改善/);
});
test('chat experiment format captures plans; status updates retain the same experiment and uncertainty',()=>{
 let p=prepareMemory(emptyProfile('u'),'行动实验：午休散步\n假设：如果散步，下午可能更清醒\n计划：散步十分钟\n观察方式：记录困倦程度',origin()).profile;
 assert.equal(p.entries.length,1);const id=p.entries[0].id;assert.equal(p.entries[0].certainty,'tentative');assert.equal(currentCycle(p.entries[0]).status,'draft');
 p=prepareMemory(p,'结果：没有改善\n复盘：目前还不支持这个假设',origin(),[],id).profile;assert.equal(currentCycle(p.entries[0]).result.text,'没有改善');
 assert.equal(currentCycle(p.entries[0]).learning.text,'目前还不支持这个假设');
 p=prepareMemory(p,'复盘：假设我是虚构的人物',origin(),[],id).profile;assert.equal(currentCycle(p.entries[0]).learning.text,'目前还不支持这个假设');
 p=prepareMemory(p,'那个完成了',origin(),[{kind:'activity',key:p.entries[0].key,text:'那个完成了',certain:true,resolve:true,replaces:[id]}],id).profile;
 assert.equal(p.entries.length,1);assert.equal(p.entries[0].id,id);assert.equal(currentCycle(p.entries[0]).status,'awaiting_review');
});
test('semantic experiment evidence rejects foreign IDs, fabricated quotes and question truncation',()=>{
 let p=change(base(),'start',plan),id=p.entries[0].id,revision=p.revision;
 updateExperiments(p,[{id,field:'result',quote:'我已经好了'},{id:crypto.randomUUID(),field:'result',quote:'没变化'}],'没变化',origin());assert.equal(p.revision,revision);
 updateExperiments(p,[{id,field:'result',quote:'有改善'}],'有改善吗？',origin());assert.equal(p.revision,revision);
 updateExperiments(p,[{id,field:'result',quote:'没变化'}],'我试过了，没变化',origin());assert.equal(currentCycle(p.entries[0]).result.text,'没变化');assert.equal(currentCycle(p.entries[0]).status,'running');
 updateExperiments(p,[{id,field:'learning',quote:'目前还不支持这个假设'}],'目前还不支持这个假设',origin());assert.equal(currentCycle(p.entries[0]).learning.text,'目前还不支持这个假设');
});
test('merged context intent uses the existing extraction call, respects explicit listening and rejects invented evidence',async t=>{
 const cloud=await provider(t,{turnAnalysis:{memories:[],intent:{intent:'L2.3_action_discussion',confidence:.92,quote:'就按刚才说的试试'},experiments:[]}}),{url}=await app(t,cloud.env),c=client(url);
 await c.chat('最近工作的事让我困惑');const start=cloud.requests.length;
 const result=(await c.chat('就按刚才说的试试')).events[0];assert.equal(cloud.requests.length-start,3);assert.equal(result.intentSource,'merged-context');assert.equal(result.state.current,'ACTION_PHASE');
 const merged=cloud.requests.filter(r=>r.body.messages[0].content.includes('TURN_ANALYSIS')).at(-1);assert.match(merged.body.messages[0].content,/最近工作的事让我困惑/);
 const listen=(await c.chat('我不要建议，只想倾诉')).events[0];assert.equal(listen.state.current,'EMPATHY_PHASE');assert.equal(listen.intentSource,'local-rules');
});
test('experiment API respects revisions and owners, and failed streamed turns roll back field updates',async t=>{
 let target;
 const cloud=await provider(t,{truncated:true,turnAnalysis:()=>({memories:[],experiments:[{id:target,field:'result',quote:'三天都没有改善'}]})}),{url}=await app(t,cloud.env),c=client(url);
 let p=await(await c.request('/api/memories')).json();p=await(await c.request('/api/memories',{method:'POST',body:JSON.stringify({revision:p.revision,action:'add',kind:'activity',text:'我正在尝试午休散步'})})).json();target=p.entries[0].id;
 p=await(await c.request('/api/memories',{method:'POST',body:JSON.stringify({revision:p.revision,action:'experiment',id:target,experiment:{operation:'start',fields:plan}})})).json();
 await c.chat('三天都没有改善');const after=await(await c.request('/api/memories')).json();assert.equal(after.revision,p.revision);assert.equal(after.entries[0].experiment.cycles[0].result,undefined);
 const stranger=client(url);assert.equal((await stranger.request('/api/memories',{method:'POST',body:JSON.stringify({revision:0,action:'experiment',id:target,experiment:{operation:'save',fields:{result:'wrong'}}})})).status,404);
 assert.equal((await c.request('/api/memories',{method:'POST',body:JSON.stringify({revision:p.revision-1,action:'experiment',id:target,experiment:{operation:'cancel'}})})).status,409);
});
test('session health supports continue, close and new conversation without deleting memory',async t=>{
 const store=new SessionStore(),{url}=await app(t,undefined,store),c=client(url);await c.chat('我正在写论文');
 const record=[...store.records.values()][0],state=record.state;state.turnCount=51;store.set(record.owner,c.id,state);
 assert.equal((await(await c.request('/api/session/health')).json()).status,'turn_limit');
 assert.equal((await c.request('/api/session',{method:'POST',body:JSON.stringify({action:'continue'})})).status,200);
 assert.equal((await(await c.request('/api/session/health')).json()).status,'healthy');
 await c.request('/api/session',{method:'POST',body:JSON.stringify({action:'close'})});assert.equal((await c.state()).health.status,'closed');assert.equal((await c.state()).memory.entries.length,1);
 await c.chat('我想继续聊聊');assert.equal((await c.state()).health.status,'healthy');
 const other=client(url);assert.equal((await(await other.request('/api/session/health')).json()).status,'not_found');
});
test('health notices never interrupt safety support and elapsed thresholds use a renewable checkpoint',async()=>{
 const o=new ConversationOrchestrator({APP_MODE:'demo'});let state=(await o.processTurn({userId:'u',sessionId:'s',userInput:'你好'})).updatedState;
 state.startedAt=new Date(Date.now()-4*3600000).toISOString();assert.equal(sessionHealth(state).status,'duration_limit');
 state.healthCheckpoint={at:new Date().toISOString(),turnCount:state.turnCount};assert.equal(sessionHealth(state).status,'healthy');
 state.currentState='SAFETY_PROTOCOL';state.lastActiveAt='2000-01-01T00:00:00Z';assert.equal(sessionHealth(state).status,'safety_support');
});
test('journey limits automatic exploration while preserving explicit pacing and listening',()=>{
 const decision={nextState:'EXPLORE_PHASE',empathyLevel:'L3',constraints:{},shouldProgress:true,reason:'automatic',transitionScore:1};
 const state={recentHistory:[{role:'user',state:'EXPLORE_PHASE'}]},journey={maxExploreDepth:1,avoidStates:[]};
 assert.equal(applyJourneyPolicy(decision,state,journey,'L2.9_ambiguous_intent','嗯').nextState,'EMPATHY_PHASE');
 assert.equal(applyJourneyPolicy(decision,state,journey,'L2.2_exploration_request','我想继续梳理').nextState,'EXPLORE_PHASE');
 assert.equal(applyJourneyPolicy(decision,state,journey,'L2.5_advice_seeking','不用给建议，先听我说').nextState,'EMPATHY_PHASE');
});
