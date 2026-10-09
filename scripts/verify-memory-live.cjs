// Uses only synthetic fixtures and its own temporary owner/store; never reads the user's chat file.
// Run with node --env-file-if-exists=.env scripts/verify-memory-live.cjs [--local]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join, dirname, basename } = require('node:path');
const { tmpdir } = require('node:os');
const { once } = require('node:events');
const { createApp } = require('../dist/server');
const { SessionStore } = require('../dist/server/session-store');
const { client, parse } = require('../tests/helpers.cjs');
const backend = process.argv.includes('--local') ? 'local' : 'cloud';
async function run() {
  const dir = fs.mkdtempSync(join(tmpdir(), 'empathy-memory-live-')), file = join(dir, 'sessions.json');
  const server = createApp(process.env, new SessionStore(file));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const c = client(`http://127.0.0.1:${server.address().port}`), results = [];
  const profile = async () => (await c.request('/api/memories')).json();
  const send = async (message, session) => {
    const start = performance.now();
    const r = await c.request('/api/chat', {method:'POST', headers:session?{'makers-conversation-id':session}:{}, body:JSON.stringify({message,backend})});
    assert.equal(r.status,200);
    const events = parse(await r.text()), final = events.find(e=>e.type==='ai_response');
    assert.ok(final, events.find(e=>e.type==='error_message')?.content || 'Missing final');
    const deltas = events.filter(e=>e.type==='ai_delta').length;
    results.push({backend,elapsedMs:Math.round(performance.now()-start),deltas,used:final.memory.memoriesUsed,updates:final.memory.memoriesUpdated});
    return final;
  };
  try {
    await send('我叫测试小岚。我正在准备摄影展。我今天很焦虑。我决定周末休息。');
    let p = await profile();
    assert.ok(['emotion','activity','decision','profile'].every(kind=>p.entries.some(e=>e.kind===kind&&e.status==='active')));
    const owner=JSON.parse(fs.readFileSync(file,'utf8')).profiles[0].owner;
    assert.equal(new SessionStore(file).getMemory(owner).entries.length,p.entries.length);
    const response = await send('延续上次的话题，我正在做什么？请简短回答。',crypto.randomUUID());
    assert.ok(response.memory.memoriesUsed>0); assert.ok(results.at(-1).deltas>0);
    // The cloud smoke test checks actual generation, not merely that memory was selected.
    if (backend==='cloud') assert.match(response.content,/摄影|展/);
    const clear=await c.request('/api/memories',{method:'POST',body:JSON.stringify({revision:p.revision,action:'clear'})});
    if(clear.status===409) {p=await profile();assert.equal((await c.request('/api/memories',{method:'POST',body:JSON.stringify({revision:p.revision,action:'clear'})})).status,200);}
    else assert.equal(clear.status,200);
    assert.equal((await profile()).entries.length,0);
    fs.mkdirSync('artifacts',{recursive:true}); fs.writeFileSync(`artifacts/memory-live-${backend}.json`,JSON.stringify({time:new Date().toISOString(),passed:true,results},null,2));
    console.log(JSON.stringify({passed:true,backend,results}));
  } finally {
    await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
    if(dirname(dir)===tmpdir()&&basename(dir).startsWith('empathy-memory-live-')) fs.rmSync(dir,{recursive:true,force:true});
  }
}
run().catch(error=>{console.error(error.message);process.exitCode=1;});
