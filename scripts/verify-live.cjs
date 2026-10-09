// Explicit opt-in smoke test: uses synthetic messages, deletes its own sessions.
// --cloud additionally invokes the configured paid provider once.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { client } = require('../tests/helpers.cjs');
const { createSSEParser } = require('../src/sse');
const base = process.env.VERIFY_URL || 'http://127.0.0.1:3000';
async function cleanup(c) {
  const memory = await (await c.request('/api/memories')).json();
  assert.equal((await c.request('/api/memories',{method:'POST',body:JSON.stringify({revision:memory.revision,action:'clear'})})).status,200);
  await c.request('/api/session',{method:'DELETE'});
}
async function turn(c, message, backend, stopAfterDelta = false) {
  const started = performance.now(); let firstDeltaMs, deltas = 0, final, failure, stop;
  const r = await c.request('/api/chat', {method:'POST', body:JSON.stringify({message,backend})});
  assert.equal(r.status, 200, `HTTP ${r.status}`);
  const parser = createSSEParser(event => {
    if(event.data === '[DONE]') return;
    const value = JSON.parse(event.data);
    if(value.type === 'ai_delta') {
      firstDeltaMs ??= Math.round(performance.now()-started); deltas++;
      if(stopAfterDelta && !stop) stop=c.request('/api/stop',{method:'POST'});
    }
    if(value.type === 'ai_response') final=value;
    if(value.type === 'error_message') failure=value.content;
  });
  const decoder = new TextDecoder();
  for await(const chunk of r.body) parser.feed(decoder.decode(chunk,{stream:true}));
  parser.feed(decoder.decode());parser.finish();
  if(stop) await stop;
  if(stopAfterDelta) { assert.ok(deltas); assert.equal(final,undefined); }
  else { assert.ok(final,failure || 'Missing final reply'); assert.ok(deltas>1); }
  return {backend,firstDeltaMs,deltas,totalMs:Math.round(performance.now()-started),reply:final?.content,
    analysisSource:final?.analysisSource,sourceCount:final?.sources?.length,stopped:stopAfterDelta};
}
(async()=>{
  const results=[];
  for(const message of ['我担心明天的演示会忘词，心里很紧张。','I feel lonely after moving to a new city. I just want someone to listen.']) {
    const c=client(base);
    try { const result=await turn(c,message,'local');results.push(result);console.log(JSON.stringify(result)); }
    finally { await cleanup(c); }
  }
  const c=client(base);
  try {
    results.push(await turn(c,'I am worried about my new job. Please help me think it through.','local',true));
    assert.equal((await c.state()).history.length,0);
    results.push(await turn(c,'I feel nervous about tomorrow. Please keep your reply brief.','local'));
  } finally { await cleanup(c); }
  if(process.argv.includes('--cloud')) {
    const cloud=client(base);
    try { results.push(await turn(cloud,'我担心明天的演示会忘词，心里很紧张。','cloud')); }
    finally { await cleanup(cloud); }
  }
  fs.mkdirSync('artifacts',{recursive:true});
  fs.writeFileSync('artifacts/local-model-live.json',JSON.stringify({time:new Date().toISOString(),results},null,2));
  console.log(JSON.stringify(results,null,2));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
