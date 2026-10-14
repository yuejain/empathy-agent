const test = require('node:test');
const assert = require('node:assert/strict');
const {mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync} = require('node:fs');
const {join, resolve} = require('node:path');
const {tmpdir} = require('node:os');
const {SessionStore} = require('../dist/server/session-store');
const {ConversationOrchestrator} = require('../dist/lib/orchestrator');
const {mutateMemory} = require('../dist/lib/memory');
const {app, client} = require('./helpers.cjs');
const localPython = resolve(process.platform === 'win32' ? '.venv-ml/Scripts/python.exe' : '.venv-ml/bin/python');
const python = process.env.PYTHON_EXECUTABLE || (existsSync(localPython) ? localPython : 'python');
const sqlite = {backend:'sqlite', pythonExecutable:python};
function temp(t) { const dir=mkdtempSync(join(tmpdir(),'empathy-storage-')); t.after(()=>rmSync(dir,{recursive:true,force:true})); return join(dir,'sessions.json'); }
async function turn(owner='u',id='s',text='我正在写论文') {return new ConversationOrchestrator({APP_MODE:'demo'}).processTurn({userId:owner,sessionId:owner+':'+id,userInput:text});}

test('async transactions publish only after persistence and serialize revision checks without lost writes', async t=>{
 const file=temp(t),store=new SessionStore(file),r=await turn();
 let release; const wait=new Promise(resolve=>release=resolve),persist=store.persist.bind(store);
 store.persist=async(...args)=>{await wait;await persist(...args);};
 const write=store.set('u','s',r.updatedState,r.updatedMemory,0);
 assert.equal(store.get('u','s'),undefined);assert.equal(store.getMemory('u').entries.length,0);
 release();await write;assert.equal(store.get('u','s').turnCount,1);
 const p=store.getMemory('u');const changed=mutateMemory(p,{action:'clear',revision:p.revision},{sessionId:'u:s',turnId:'clear',now:Date.now()});
 const results=await Promise.allSettled([store.setMemory('u',changed,p.revision),store.setMemory('u',changed,p.revision)]);
 assert.equal(results[0].status,'fulfilled');assert.equal(results[1].status,'rejected');
 assert.equal(new SessionStore(file).getMemory('u').entries.length,0);
});

test('cancellation while queued for persistence never publishes the cancelled turn', async t=>{
 const store=new SessionStore(temp(t)),first=await turn('first'),second=await turn('second');
 let release;const gate=new Promise(resolve=>release=resolve),persist=store.persist.bind(store);
 store.persist=async(...args)=>{await gate;await persist(...args);};
 const one=store.set('first','s',first.updatedState,first.updatedMemory,0);
 const controller=new AbortController(),two=store.set('second','s',second.updatedState,second.updatedMemory,0,controller.signal);
 const rejected=assert.rejects(two,{name:'AbortError'});controller.abort();release();await one;await rejected;
 assert.equal(store.getMemory('second').entries.length,0);assert.equal(store.get('second','s'),undefined);
 assert.equal(new SessionStore(store.file).getMemory('first').entries.length,1);
});

test('SQLite server startup failure closes its child instead of hanging on an occupied port',async t=>{
 const {createServer}=require('node:http'),{once}=require('node:events'),{spawn}=require('node:child_process');
 const listener=createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');
 t.after(()=>new Promise(resolve=>listener.close(resolve)));
 const file=temp(t),child=spawn(process.execPath,['dist/server/index.js'],{cwd:resolve('.'),windowsHide:true,
  env:{...process.env,APP_MODE:'demo',SESSION_PERSISTENCE:'true',SESSION_STORAGE:'sqlite',PYTHON_EXECUTABLE:python,DATA_DIR:require('node:path').dirname(file),PORT:String(listener.address().port)},stdio:['ignore','pipe','pipe']});
 child.stdout.resume();let errors='';child.stderr.on('data',chunk=>{errors=(errors+chunk).slice(-2000);});
 const timeout=setTimeout(()=>child.kill(),10000);
 try { const [code]=await once(child,'exit');assert.equal(code,1);assert.match(errors,/已被占用/); }
 finally {clearTimeout(timeout);child.kill();}
});

test('SQLite imports validated JSON once and preserves atomic memory, affect and owner isolation across restart',async t=>{
 const file=temp(t),seed=new SessionStore(file),r=await turn();
 await seed.set('u','s',r.updatedState,r.updatedMemory,0);const original=readFileSync(file,'utf8');
 const store=new SessionStore(file,undefined,undefined,sqlite);await store.ready;
 try {
  assert.equal(store.backend,'sqlite');assert.equal(store.get('u','s').turnCount,1);
  assert.deepEqual(store.getMemory('u'),seed.getMemory('u'));assert.equal(store.get('other','s'),undefined);
  const p=store.getMemory('u'),cleared=mutateMemory(p,{action:'clear',revision:p.revision},{sessionId:'u:s',turnId:'clear',now:Date.now()});
  await store.setMemory('u',cleared,p.revision);await store.delete('u','s');
  await assert.rejects(store.setMemory('u',p,p.revision));
 } finally {await store.close();}
 assert.equal(readFileSync(file,'utf8'),original);
 assert.throws(()=>new SessionStore(file),/SQLite/);
 // A stale or corrupt migration source can never resurrect forgotten state.
 writeFileSync(file,'INVALID OLD JSON');
 const reopened=new SessionStore(file,undefined,undefined,sqlite);await reopened.ready;
 try {assert.equal(reopened.getMemory('u').entries.length,0);assert.equal(reopened.get('u','s'),undefined);}
 finally {await reopened.close();}
});

test('SQLite startup rejects corrupt migration sources and worker failure cannot publish memory',async t=>{
 const file=temp(t);writeFileSync(file,'not a snapshot');
 const corrupt=new SessionStore(file,undefined,undefined,sqlite);
 await assert.rejects(corrupt.ready,/初始化/);assert.equal(readFileSync(file,'utf8'),'not a snapshot');await corrupt.close();
 // An uninitialized DB from a failed import may retry only after the source is repaired.
 writeFileSync(file,JSON.stringify({version:2,sessions:[],profiles:[]}));
 const store=new SessionStore(file,undefined,undefined,sqlite);await store.ready;
 const r=await turn();await store.writer.close();
 await assert.rejects(store.set('u','s',r.updatedState,r.updatedMemory,0));
 assert.equal(store.get('u','s'),undefined);assert.equal(store.getMemory('u').entries.length,0);
 await store.close();
});

test('HTTP SQLite flow persists completed turns and keeps static validators separate from private no-store responses',async t=>{
 const file=temp(t),store=new SessionStore(file,undefined,undefined,sqlite);await store.ready;
 const {server,url}=await app(t,undefined,store),c=client(url);
 try {
  const page=await fetch(url+'/app.js'),etag=page.headers.get('etag');assert.ok(etag);await page.arrayBuffer();
  assert.equal((await fetch(url+'/app.js',{headers:{'If-None-Match':etag}})).status,304);
  const health=await fetch(url+'/api/health');assert.equal((await health.json()).storage,'sqlite');assert.equal(health.headers.get('cache-control'),'no-store');
  const response=await c.chat('我叫小林');assert.equal(response.events[0].type,'ai_response');assert.ok(response.events[0].timings.persistenceMs>=0);
  assert.equal((await c.state()).memory.entries.length,1);
  const memory=await c.request('/api/memories');assert.equal(memory.headers.get('etag'),null);assert.equal(memory.headers.get('cache-control'),'no-store');
 } finally {await server.closeStorage();}
});
