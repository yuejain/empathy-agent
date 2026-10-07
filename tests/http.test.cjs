const { test } = require('node:test');
const assert = require('node:assert/strict');
const { app, client, provider } = require('./helpers.cjs');

test('static UI, health, durable conversation recovery and clear endpoint', async t => {
  const {url}=await app(t), c=client(url);
  const page=await fetch(url); assert.match(await page.text(),/留白/); assert.match(page.headers.get('content-security-policy'),/script-src 'self'/);
  assert.equal((await (await fetch(url+'/api/health')).json()).mode,'demo');
  assert.equal((await c.chat('你好')).events[0].state.turnCount,1);
  assert.equal((await c.state()).history.length,2);
  await c.chat('记住：喜欢读书'); assert.equal((await c.state()).memories[0],'喜欢读书');
  assert.equal((await c.request('/api/session',{method:'DELETE'})).status,200);
  assert.equal((await c.state()).history.length,0);
});
test('two browsers with the same conversation ID cannot read or delete each other',async t=>{
  const {url}=await app(t), id=crypto.randomUUID(), a=client(url,id), b=client(url,id);
  await a.chat('记住：私有测试标记'); assert.equal((await b.state()).history.length,0);
  await b.request('/api/session',{method:'DELETE'}); assert.match(JSON.stringify(await a.state()),/私有测试标记/);
});
test('validate bodies, methods, origin, host, paths and missing session', async t=>{
  const {url}=await app(t), c=client(url);
  for(const message of ['', '   ', 42, {}, 'a'.repeat(2001)]) assert.equal((await c.chat(message)).status,400);
  assert.equal((await c.request('/api/chat',{method:'POST',body:'{'})).status,400);
  assert.equal((await c.request('/api/chat',{method:'POST',body:JSON.stringify({message:'x'.repeat(17000)})})).status,413);
  assert.equal((await c.request('/api/chat',{method:'POST',body:'x',headers:{'Content-Type':'text/plain'}})).status,415);
  assert.equal((await c.request('/api/chat')).status,405);
  assert.equal((await c.request('/api/chat',{method:'POST',body:'{}',headers:{Origin:'https://evil.example'}})).status,403);
  const hostStatus = await new Promise((resolve, reject) => {
    require('node:http').get(url + '/api/session', { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(hostStatus,403);
  assert.equal((await fetch(url+'/.env')).status,404);
  assert.equal((await fetch(url+'/api/session')).status,400);
});
test('live API receives configured model, normalized URL, history and explicit memory', async t=>{
  const p=await provider(t), {url}=await app(t,p.env), c=client(url);
  await c.chat('记住：我的名字叫小林'); const result=await c.chat('最近工作很累');
  assert.equal(result.events[0].mode,'live'); assert.match(result.events[0].content,/工作/);
  const generation=p.requests.at(-1); assert.equal(generation.path,'/v1/chat/completions'); assert.equal(generation.body.model,'fixture-model'); assert.equal(generation.auth,'Bearer fixture-secret');
  assert.match(generation.body.messages[0].content,/小林/); assert.ok(generation.body.messages.some(m=>m.role==='assistant'));
  assert.doesNotMatch(JSON.stringify(await c.state()),/fixture-secret/);
});
for(const [name, options, code] of [['auth',{status:401},'AUTH'],['rate limit',{status:429},'RATE_LIMIT'],['upstream',{status:503},'UPSTREAM'],['timeout',{delay:250,timeout:100},'TIMEOUT'],['empty response',{content:''},'INVALID_RESPONSE']]) {
  test(`live ${name} is reported without storing a fake successful reply`,async t=>{
    const p=await provider(t,options),{url}=await app(t,p.env),c=client(url); const r=await c.chat('聊聊最近的工作');
    assert.equal(r.events[0].type,'error_message'); assert.equal(r.events[0].code,code); assert.doesNotMatch(JSON.stringify(r),/secret-key|fixture-secret/); assert.equal((await c.state()).history.length,0);
  });
}
test('stop aborts upstream requests, releases session lock, and does not persist half a turn',async t=>{
  const p=await provider(t,{delay:300}),{url}=await app(t,p.env),c=client(url); await c.state();
  const r=await c.request('/api/chat',{method:'POST',body:JSON.stringify({message:'你好'})});
  assert.equal((await c.chat('重复发送')).status,409);
  assert.equal((await c.request('/api/session',{method:'DELETE'})).status,409);
  assert.equal((await c.request('/api/stop',{method:'POST'})).status,200); await r.text();
  assert.equal((await c.state()).history.length,0);
  assert.equal((await c.chat('我不想活了')).events[0].state.current,'SAFETY_PROTOCOL');
});
test('rate limit returns a useful 429 response',async t=>{
  const {url}=await app(t),c=client(url); for(let i=0;i<20;i++) assert.equal((await c.chat('你好')).status,200);
  assert.equal((await c.chat('你好')).status,429);
});
