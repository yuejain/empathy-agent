const {test}=require('node:test');
const assert=require('node:assert/strict');
const {emptyProfile,prepareMemory,mutateMemory,retrieveMemories,DAY}=require('../dist/lib/memory');
const {retrievalRequest,validSemanticScores,boundedHistory}=require('../dist/lib/context/retrieval');
const {continuityView}=require('../dist/lib/context/continuity');
const {communicationGuidance}=require('../dist/lib/intent/router');
const {ConversationOrchestrator}=require('../dist/lib/orchestrator');
const {app,client,provider}=require('./helpers.cjs');
const now=Date.now(),origin=(sessionId='s',time=now)=>({sessionId,turnId:'1',now:time});
const remember=(p,text,session='s',time=now)=>prepareMemory(p,text,origin(session,time)).profile;
const edit=(p,op)=>mutateMemory(p,{revision:p.revision,...op},origin());

test('hybrid retrieval recalls cross-language matches and rejects stale or foreign IDs',()=>{
 let p=remember(emptyProfile('u'),'我喜欢园艺。我喜欢读书');
 const id=p.entries[0].id,request=retrievalRequest('Growing plants helps me relax',p,[]);
 const scores=validSemanticScores([{id,score:.85},{id:crypto.randomUUID(),score:1}],request.candidateIds,p.entries);
 assert.equal(retrieveMemories(p,request.text,now,1800,scores)[0].id,id);assert.equal(scores.size,1);
 p=edit(p,{action:'delete',id});assert.equal(validSemanticScores([{id,score:1}],request.candidateIds,p.entries).size,0);
 p=edit(p,{action:'settings',recall:false});assert.deepEqual(retrievalRequest('continue',p,[]).memories,[]);
});
test('follow-on queries use valid user context, not assistant suggestions or obsolete history',()=>{
 const p=remember(emptyProfile('u'),'我正在写论文');
 const history=[{role:'user',content:'论文的实验没有进展',timestamp:new Date().toISOString(),memoryEpoch:p.contextEpoch},{role:'assistant',content:'建议你辞职去旅行',timestamp:new Date().toISOString(),memoryEpoch:p.contextEpoch}];
 const query=retrievalRequest('那接下来怎么办',p,boundedHistory(history,p.contextEpoch));
 assert.match(query.query,/论文的实验/);assert.doesNotMatch(query.query,/辞职/);
 assert.equal(retrievalRequest('我改去北京，不再讨论论文',p,history).expanded,false);
 const cleared=edit(p,{action:'clear'});assert.deepEqual(boundedHistory(history,cleared.contextEpoch),[]);
 assert.equal(retrievalRequest('继续聊',cleared,boundedHistory(history,cleared.contextEpoch)).expanded,false);
});
test('task updates distinguish blocked, not finished, completed, cancelled and ambiguous pronouns',()=>{
 let p=remember(emptyProfile('u'),'我正在写论文');p=remember(p,'论文卡住了');
 assert.equal(continuityView(p).tasks[0].progress,'blocked');
 p=remember(p,'我还没完成论文');assert.equal(continuityView(p).tasks[0].progress,'in_progress');
 p=remember(p,'我已经完成了论文');assert.equal(continuityView(p).tasks[0].progress,'completed');
 assert.equal(continuityView(p).journey.stage,'journey_stage_3');
 let q=remember(emptyProfile('u'),'我正在写报告。我正在准备面试');const before=q.revision;
 q=remember(q,'那个完成了');assert.equal(q.revision,before,'ambiguous task must not be marked complete');
 q=prepareMemory(q,'那个完成了',origin(),[],q.entries[1].id).profile;assert.equal(q.entries[1].progress,'completed');
 q=edit(q,{action:'progress',id:q.entries[0].id,progress:'cancelled',dueAt:now+DAY});
 assert.equal(q.entries[0].status,'resolved');assert.equal(q.entries[0].dueAt,now+DAY);
});
test('task uncertainty and pending records are not promoted by follow-up or a deadline',()=>{
 let p=remember(emptyProfile('u'),'我考虑辞职');p=edit(p,{action:'progress',id:p.entries[0].id,progress:'planned',dueAt:now+DAY});
 assert.equal(continuityView(p).tasks[0].certainty,'tentative');
 const revision=p.revision;p=remember(p,'如果完成了会怎样？');assert.equal(p.revision,revision);
 p=edit(p,{action:'delete',id:p.entries[0].id});assert.deepEqual(continuityView(p).tasks,[]);
});
test('emotion history spans sessions, respects chronology, and disappears on correction or deletion',()=>{
 let p=remember(emptyProfile('u'),'我很焦虑','one',now-3*DAY);
 p=remember(p,'我很难过','two',now-2*DAY);p=remember(p,'我现在很开心','three',now-DAY);
 let view=continuityView(p,now);assert.equal(view.trend.sessions,3);assert.equal(view.trend.direction,'more_positive');
 assert.equal(view.trend.points[0].emotion,'焦虑');
 const first=p.entries[0].id;p=edit(p,{action:'delete',id:first});view=continuityView(p,now);
 assert.equal(view.trend.points.some(x=>x.sourceId===first),false);assert.equal(view.trend.direction,'insufficient');
 p=edit(p,{action:'settings',recall:false});assert.equal(continuityView(p).trend.points.length,0);
 p=edit(p,{action:'clear'});assert.equal(continuityView(p).trend.observations,0);
});
test('inferred emotion and repeated same-session messages cannot establish a cross-session trend',()=>{
 let p=emptyProfile('u');for(const text of ['我很焦虑','我很难过','我很开心'])p=remember(p,text);
 assert.equal(continuityView(p).trend.observations,1);assert.equal(continuityView(p).trend.direction,'insufficient');
 p.entries[0].certainty='inferred';assert.equal(continuityView(p).trend.direction,'insufficient');
});
test('communication preferences affect future replies and removal leaves no separate hidden preference cache',()=>{
 let p=remember(emptyProfile('u'),'直接一点');assert.equal(p.entries.length,1);
 assert.equal(communicationGuidance(p.entries,'你好').style,'direct');
 p=remember(p,'详细一点');assert.equal(communicationGuidance(p.entries,'你好').style,'detailed');
 p=remember(p,'别总问问题');assert.equal(communicationGuidance(p.entries,'你好').noQuestions,true);
 p=edit(p,{action:'clear'});assert.equal(communicationGuidance(p.entries,'你好').style,'default');
 assert.equal(communicationGuidance(p.entries,'你好').noQuestions,false);
 p=remember(p,'别总问问题');p=remember(p,'可以问问题了');assert.equal(communicationGuidance(p.entries,'你好').noQuestions,false);
});
test('explicit entry preferences and self-reported direction update journey without inferring personality',()=>{
 let p=remember(emptyProfile('u'),'我喜欢场景联想');assert.equal(continuityView(p).preferredEntry,'scenario');
 p=remember(p,'我明确了方向，我想继续读书');assert.equal(continuityView(p).journey.stage,'journey_stage_4');
 p=edit(p,{action:'clear'});assert.equal(continuityView(p).preferredEntry,undefined);assert.equal(continuityView(p).journey.stage,'journey_stage_1');
});
test('reflection narrative contains only subsequent user evidence and is removed with its memory record',async t=>{
 const cloud=await provider(t,{memories:[{kind:'activity',quote:'我正在写论文',topic:'论文',certainty:'stated',state:'current',subject:'user'}]});
 const {url}=await app(t,cloud.env),c=client(url);
 await c.chat('我想做关键词联想练习');await c.chat('我选A');await c.chat('这让我想到我正在写论文。');
 let p=(await c.state()).memory;assert.equal(p.continuity.reflectionHistory.length,1);assert.equal(p.continuity.reflectionHistory[0].statement,'我正在写论文');
 await c.request('/api/memories',{method:'POST',body:JSON.stringify({revision:p.revision,action:'delete',id:p.continuity.reflectionHistory[0].id})});
 assert.equal((await c.state()).memory.continuity.reflectionHistory.length,0);
});
test('games persist selection, skip extraction and expose a bounded bridge into ordinary conversation',async t=>{
 const cloud=await provider(t),local=await provider(t,{localKnowledge:true});
 const {url}=await app(t,{...cloud.env,LOCAL_ML_URL:local.env.AI_GATEWAY_BASE_URL.replace('/v1','')}),c=client(url);
 let r=await c.chat('我想做场景联想练习');assert.equal(r.events[0].reflection.options.length,3);
 assert.equal(cloud.requests.length,0);assert.equal(local.requests.length,0);
 r=await c.chat('我选B');assert.equal(r.events[0].reflection.selected,1);assert.equal(cloud.requests.length,0);
 const state=await c.state();assert.equal(state.reflection.selected,1);assert.equal(state.memory.entries.length,0);
 await c.chat('这让我想到工作中的事情');assert.match(cloud.requests.find(x=>x.body.stream).body.messages[0].content,/REFLECTION_CONTEXT/);
 await c.chat('忘记所有记忆');assert.equal((await c.state()).reflection,undefined);
});
test('main flow forwards joint retrieval, progress, dated trends and communication preferences to cloud',async t=>{
 const cloud=await provider(t),local=await provider(t,{localKnowledge:true,analysis:{emotion:'fear',confidence:.8,scores:{fear:.8},label_source:'local-trained-head',hits:[],index_size:1,memory_hits:[]}});
 const {url}=await app(t,{...cloud.env,LOCAL_ML_URL:local.env.AI_GATEWAY_BASE_URL.replace('/v1','')}),c=client(url);
 await c.chat('我正在写论文');await c.chat('直接一点');const result=await c.chat('那论文有什么进展？');
 const message=cloud.requests.filter(r=>r.body.stream).at(-1).body.messages[0].content;
 assert.match(message,/CONTINUITY_CONTEXT/);assert.match(message,/我正在写论文/);assert.match(message,/直接回应重点/);
 assert.equal(result.events[0].state.current,'REVIEW_PHASE');assert.equal(result.events[0].retrieval.mode,'semantic-hybrid');
 assert.ok(local.requests.at(-1).body.memories.length>0);assert.equal(result.events[0].continuity.tasks[0].progress,'in_progress');
 assert.ok(result.events[0].timings.preparationMs>=0);
 const p=(await c.state()).memory;await c.request('/api/memories',{method:'POST',body:JSON.stringify({revision:p.revision,action:'clear'})});
 await c.chat('继续聊');assert.equal(local.requests.at(-1).body.memories.length,0);
 assert.doesNotMatch(cloud.requests.filter(r=>r.body.stream).at(-1).body.messages[0].content,/我正在写论文|直接回应重点/);
});
test('safety and extraction overlap rather than run serially; deterministic memory commands use no cloud',async t=>{
 const cloud=await provider(t,{delay:150,timeout:2000}),{url}=await app(t,cloud.env),c=client(url);
 await c.chat('记住：我叫小林');assert.equal(cloud.requests.length,0);
 const result=(await c.chat('我很焦虑')).events[0];
 assert.ok(result.timings.preparationMs < result.timings.safetyMs+result.timings.extractionMs-70,JSON.stringify(result.timings));
});
test('corpus maintenance validates operations before any local service call',async t=>{
 const {url}=await app(t),c=client(url);
 assert.equal((await c.request('/api/corpus',{method:'POST',body:JSON.stringify({action:'shell',command:'anything'})})).status,400);
 assert.equal((await c.request('/api/corpus',{method:'POST',body:JSON.stringify({scheduleHours:1})})).status,400);
 assert.equal((await c.request('/api/corpus')).status,503);
});
