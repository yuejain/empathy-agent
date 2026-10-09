const {test}=require('node:test');
const assert=require('node:assert/strict');
const {app,client,provider,parse}=require('./helpers.cjs');
const {ChatGateway}=require('../dist/lib/gateway');
const {OutputFilter}=require('../dist/lib/empathy-decision');
const {castCoins,reflectionGame,requestedGame}=require('../dist/lib/tarot/reflection-games');
const {LocalKnowledge}=require('../dist/lib/local-knowledge');

test('real provider SSE is forwarded incrementally before the persisted final response',async t=>{
 const p=await provider(t,{deltaDelay:3}),{url}=await app(t,p.env),c=client(url);
 const response=await c.request('/api/chat',{method:'POST',body:JSON.stringify({message:'工作很累'})});
 const reader=response.body.getReader(); let text='',firstPartial=false; const decoder=new TextDecoder();
 while(true){const {value,done}=await reader.read(); if(done)break; text+=decoder.decode(value,{stream:true}); if(text.includes('ai_delta')&&!text.includes('ai_response'))firstPartial=true;}
 const events=parse(text),deltas=events.filter(e=>e.type==='ai_delta'),final=events.find(e=>e.type==='ai_response');
 assert.ok(firstPartial); assert.ok(deltas.length>1); assert.equal(deltas.map(d=>d.content).join(''),final.content);
 assert.doesNotMatch(text,/PRIVATE_REASONING/); assert.equal((await c.state()).history.length,2);
});
test('truncated upstream stream is reported and partial history is never committed',async t=>{
 const p=await provider(t,{truncated:true}),{url}=await app(t,p.env),c=client(url);
 const r=await c.request('/api/chat',{method:'POST',body:JSON.stringify({message:'工作很累'})});
 const events=parse(await r.text()); assert.ok(events.some(e=>e.type==='ai_delta'));
 assert.equal(events.at(-1).code,'INCOMPLETE_STREAM'); assert.equal((await c.state()).history.length,0);
});
test('stop after the first token cancels generation and allows another turn',async t=>{
 const p=await provider(t,{deltaDelay:50}),{url}=await app(t,p.env),c=client(url); await c.state();
 const r=await c.request('/api/chat',{method:'POST',body:JSON.stringify({message:'工作很累'})});
 const reader=r.body.getReader(); let text='';
 while(!text.includes('ai_delta')) {const chunk=await reader.read(); if(chunk.done)throw new Error('Missing delta'); text+=new TextDecoder().decode(chunk.value);}
 assert.equal((await c.request('/api/stop',{method:'POST'})).status,200);
 while(!(await reader.read()).done){}
 assert.equal((await c.state()).history.length,0);
 assert.equal((await c.chat('我不想活了')).events[0].type,'ai_response');
});
test('forbidden phrases are held and filtered even when divided across individual characters',()=>{
 const filter=new OutputFilter().streaming('L2'); let output='';
 for(const char of '你有焦虑症。我完全理解。可以慢慢说。')output+=filter.feed(char);
 output+=filter.finish(); assert.doesNotMatch(output,/你有焦虑症|我完全理解/); assert.match(output,/已过滤/);
 const overlap=new OutputFilter().streaming('L2');let protectedText='';
 for(const char of '你需要治疗')protectedText+=overlap.feed(char);
 protectedText+=overlap.finish();assert.equal(protectedText,'[已过滤]');
});
test('empty provider streams do not become successful assistant turns',async t=>{
 const p=await provider(t,{content:''});const gateway=new ChatGateway(p.env);
 await assert.rejects(async()=>{for await(const x of gateway.stream([{role:'user',content:'hi'}])){}},e=>e.code==='INVALID_RESPONSE');
});
test('coin casting follows bottom-up yin/yang and moving-line rules',()=>{
 const yin=castCoins(()=>0),yang=castCoins(()=>1);
 assert.deepEqual(yin.lines,[6,6,6,6,6,6]); assert.equal(yin.lower,0);assert.equal(yin.changedLower,7);
 assert.deepEqual(yang.lines,[9,9,9,9,9,9]);assert.equal(yang.upper,7);assert.equal(yang.changedUpper,0);
 const content=reflectionGame('iching',{userId:'u',sessionId:'s',emotion:'焦虑',intensity:.5},()=>0);
 assert.match(content,/上坤.*下坤/);assert.match(content,/变化后为上乾下乾/);assert.match(content,/不预测/);
 assert.equal(requestedGame('不要算周易'),undefined);assert.equal(requestedGame('抽情绪需要卡'),'needs');
});
test('local model configuration cannot send private text to a remote analysis service',()=>{
 assert.throws(()=>new LocalKnowledge({LOCAL_ML_URL:'https://remote.example'}));
 assert.equal(new LocalKnowledge({LOCAL_ML_URL:'http://127.0.0.1:3001'}).url,'http://127.0.0.1:3001');
});
test('local model only analyzes; cloud receives emotional direction and evidence and generates the stream',async t=>{
 const cloud=await provider(t),local=await provider(t,{localKnowledge:true}),{url}=await app(t,{...cloud.env,LOCAL_ML_URL:local.env.AI_GATEWAY_BASE_URL.replace('/v1','')});
 const c=client(url);const response=await c.request('/api/chat',{method:'POST',body:JSON.stringify({message:'本地测试工作压力，今天只想倾诉，不用给建议'})});
 const final=parse(await response.text()).find(e=>e.type==='ai_response');
 assert.ok(final);assert.equal(final.backend,'cloud');assert.equal(final.analysisSource,'local-trained-head');assert.equal(final.sources[0].source,'fixture-corpus');
 assert.equal(local.requests.length,1);assert.equal(local.requests[0].path,'/analyze');assert.equal(local.requests[0].auth,undefined);
 const generation=cloud.requests.find(r=>r.body.stream);assert.ok(generation);assert.equal(generation.auth,'Bearer fixture-secret');
 assert.match(generation.body.messages[0].content,/EMOTION_RAG_CONTEXT/);assert.match(generation.body.messages[0].content,/fixture-corpus/);
 assert.match(generation.body.messages[0].content,/先倾听与承接感受/);assert.equal(final.rag.direction.mode,'listen');assert.equal(final.rag.evidenceCount,1);
 assert.ok(!cloud.requests.some(r=>r.body.messages[0].content.includes('分析文本中表达的情绪')));
});
test('stale local-generation clients are rejected without silently forwarding their message',async t=>{
 const cloud=await provider(t),{url}=await app(t,cloud.env),c=client(url);
 const response=await c.request('/api/chat',{method:'POST',body:JSON.stringify({message:'私密测试',backend:'local'})});
 assert.equal(response.status,410);assert.equal(cloud.requests.length,0);assert.match(await response.text(),/未转发/);
});

test('unavailable RAG degrades explicitly to cloud with local lexical hints and no invented sources',async t=>{
 const cloud=await provider(t),{url}=await app(t,{...cloud.env,LOCAL_ML_URL:'http://127.0.0.1:1'}),c=client(url);
 const final=(await c.chat('我担心明天的演示')).events[0];
 assert.equal(final.backend,'cloud');assert.equal(final.rag.status,'unavailable');assert.equal(final.rag.emotion.confidence,null);assert.equal(final.rag.emotion.uncertain,true);
 assert.deepEqual(final.sources,[]);assert.match(cloud.requests.find(r=>r.body.stream).body.messages[0].content,/"status":"unavailable"/);
});
