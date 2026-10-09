const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { ChatGateway, completionUrl } = require('../dist/lib/gateway');
const { ConversationOrchestrator } = require('../dist/lib/orchestrator');
const { EmotionRecognizer } = require('../dist/lib/emotion-recognition');
const { SessionStore } = require('../dist/server/session-store');
const { createAgent } = require('../dist/agents/empathy-agent');
const { createSSEParser } = require('../src/sse');
const { provider, parse } = require('./helpers.cjs');

test('normalize standard, custom-version and complete API paths', () => {
  for (const [input, output] of [['https://example.org','https://example.org/v1/chat/completions'],['https://example.org/v1/','https://example.org/v1/chat/completions'],['http://localhost:1234/api/v3','http://localhost:1234/api/v3/chat/completions'],['https://example.org/v1/chat/completions','https://example.org/v1/chat/completions']]) assert.equal(completionUrl(input),output);
  for (const invalid of ['file:///secret','https://user:secret@example.org','https://example.org?key=secret']) assert.throws(() => completionUrl(invalid));
});
test('demo is explicit and partial configuration fails instead of pretending to work', () => {
  assert.equal(new ChatGateway({}).mode,'demo');
  assert.equal(new ChatGateway({ APP_MODE:'demo', AI_GATEWAY_API_KEY:'ignored' }).mode,'demo');
  assert.throws(() => new ChatGateway({ AI_GATEWAY_API_KEY:'secret' }), /设置/);
  assert.throws(() => new ChatGateway({ APP_MODE:'live' }), /设置/);
  assert.throws(() => new ChatGateway({ AI_TIMEOUT_MS:'NaN' }));
  assert.throws(() => new ChatGateway({ AI_GATEWAY_THINKING:'false' }), /AI_GATEWAY_THINKING/);
  assert.throws(() => new ChatGateway({ AI_GATEWAY_TOKEN_PARAM:'unknown' }), /AI_GATEWAY_TOKEN_PARAM/);
});
test('optional MiMo parameters use the requested token limit without affecting default providers', async t => {
  const p = await provider(t);
  await new ChatGateway(p.env).complete([{role:'user',content:'测试'}], {maxTokens:123});
  assert.equal(p.requests[0].body.max_tokens,123);
  assert.equal(p.requests[0].body.max_completion_tokens,undefined);
  assert.equal(p.requests[0].body.thinking,undefined);
  const gateway = new ChatGateway({...p.env,AI_GATEWAY_THINKING:'disabled',AI_GATEWAY_TOKEN_PARAM:'max_completion_tokens'});
  await gateway.complete([{role:'user',content:'测试'}], {maxTokens:456});
  assert.equal(p.requests[1].body.max_tokens,undefined);
  assert.equal(p.requests[1].body.max_completion_tokens,456);
  assert.deepEqual(p.requests[1].body.thinking,{type:'disabled'});
});
test('SSE handles named events, split CRLF, comments, multiline data and EOF', () => {
  const events = [], p = createSSEParser(e => events.push(e));
  const input = ': heartbeat\r\nevent: ai_response\r\ndata: 你好\r\ndata: world\r\n\r\ndata: [DONE]\n\n';
  for (const ch of input) p.feed(ch); p.finish();
  assert.deepEqual(events,[{event:'ai_response',data:'你好\nworld'},{event:'message',data:'[DONE]'}]);
});
test('local emotion recognition recognizes phrases and unknown inputs stay neutral', async () => {
  const r = new EmotionRecognizer({ APP_MODE:'demo' });
  assert.equal((await r.recognizeEmotion('今天我很焦虑')).primaryEmotion.name,'焦虑');
  assert.equal((await r.recognizeEmotion('你好')).valence,0);
});
test('direct conversation, exploration, action, review and goodbye are reachable', async () => {
  const o = new ConversationOrchestrator({APP_MODE:'demo'}); let state;
  for (const [input, expected] of [['你好','EMPATHY_PHASE'],['下一步怎么做','EXPLORE_PHASE'],['我愿意试试','ACTION_PHASE'],['我已经完成了','REVIEW_PHASE'],['再见','SESSION_CLOSE']]) {
    const r = await o.processTurn({userId:'u',sessionId:'s',userInput:input,sessionState:state}); state=r.updatedState; assert.equal(r.metadata.state,expected);
  }
  assert.equal(state.turnCount,5);
  assert.equal(state.stateHistory[0].fromState,'INIT');
  assert.equal(o.endSession('s').stateHistory.at(-1).fromState,'SESSION_CLOSE');
});
test('explicit memory survives the recent-history window and is cleared on request', async () => {
  const o = new ConversationOrchestrator({APP_MODE:'demo'}); let state;
  const send = async userInput => { const r=await o.processTurn({userId:'u',sessionId:'s',userInput,sessionState:state}); state=r.updatedState; return r; };
  await send('记住：我叫小林');
  for(let i=0;i<12;i++) await send('聊一聊今天的事情'+i);
  assert.equal(state.recentHistory.length,20);
  assert.match((await send('我叫什么')).response,/小林/);
  assert.equal((await send('忘记所有记忆')).updatedMemory.entries.length,0);
  assert.doesNotMatch((await send('我叫什么')).response,/小林/);
  await assert.rejects(o.processTurn({userId:'other',sessionId:'s',userInput:'你好',sessionState:state}), /身份/);
});
test('crisis routes run offline, count turns, stay supportive and do not store explicit memory', async t => {
  const p=await provider(t), o=new ConversationOrchestrator(p.env);
  for(const message of ['我不想活了','我想伤害自己','我已经吃了很多安眠药','我想杀了他','我没有朋友所以我想死']) {
    const r=await o.processTurn({userId:'u',sessionId:crypto.randomUUID(),userInput:message});
    assert.equal(r.metadata.state,'SAFETY_PROTOCOL',message); assert.match(r.response,/12356/); assert.match(r.response,/120 \/ 110/); assert.equal(r.updatedState.turnCount,1); assert.equal(r.updatedState.stateHistory[0].fromState,'INIT');
  }
  assert.equal(p.requests.length,0);
  await o.processTurn({userId:'u',sessionId:'ongoing',userInput:'我不想活了'});
  const continued=await o.processTurn({userId:'u',sessionId:'ongoing',userInput:'不知道怎么办'});
  assert.equal(continued.metadata.state,'SAFETY_PROTOCOL'); assert.equal(p.requests.length,0);
});
test('tarot actually draws a card and returns to conversation', async () => {
  const o=new ConversationOrchestrator({APP_MODE:'demo'});
  const r=await o.processTurn({userId:'u',sessionId:'s',userInput:'我想抽一张牌'});
  assert.equal(r.metadata.state,'TAROT_ENTRY'); assert.match(r.response,/A\./); assert.match(r.response,/不预测/);
  assert.equal((await o.processTurn({userId:'u',sessionId:'s',userInput:'都不像'})).metadata.state,'EMPATHY_PHASE');
});
test('session store persists, isolates owners and deletes without corrupting other users', async t => {
  const dir=mkdtempSync(join(tmpdir(),'empathy-test-')); t.after(()=>rmSync(dir,{recursive:true,force:true})); const file=join(dir,'sessions.json');
  const o=new ConversationOrchestrator({APP_MODE:'demo'}), r=await o.processTurn({userId:'a',sessionId:'a:s',userInput:'记住：我叫小林'});
  const store=new SessionStore(file); store.set('a','s',r.updatedState,r.updatedMemory,0);
  const reopened=new SessionStore(file); assert.equal(reopened.getMemory('a').entries[0].text,'我叫小林'); assert.equal(reopened.get('b','s'),undefined);
  reopened.delete('a','s'); assert.equal(new SessionStore(file).get('a','s'),undefined); assert.equal(new SessionStore(file).getMemory('a').entries.length,1);
  writeFileSync(file,'BROKEN'); assert.throws(()=>new SessionStore(file),/原文件未覆盖/); assert.equal(readFileSync(file,'utf8'),'BROKEN');
});
test('fetch adapter emits valid SSE for a real Request and rejects missing session id', async () => {
  const handler=createAgent({APP_MODE:'demo'}), request=()=>new Request('http://localhost/chat',{method:'POST',body:JSON.stringify({message:'你好'})});
  assert.equal((await handler(request(),'')).status,400);
  const r=await handler(request(),crypto.randomUUID()); assert.equal(parse(await r.text())[0].type,'ai_response');
});
