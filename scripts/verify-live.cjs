// Real local RAG smoke test. --cloud opts into paid cloud streaming with synthetic messages.
// Uses an isolated in-memory app; never reads or writes the user's conversation store.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { once } = require('node:events');
const { LocalKnowledge } = require('../dist/lib/local-knowledge');
const { createApp } = require('../dist/server');
const { SessionStore } = require('../dist/server/session-store');
const { client } = require('../tests/helpers.cjs');
const { createSSEParser } = require('../src/sse');
async function run() {
  const knowledge = new LocalKnowledge(process.env), health = await knowledge.health();
  assert.ok(health.available, 'Start the local emotion RAG service first');
  const analysis = await knowledge.analyze('I feel lonely after moving to a new city.');
  assert.ok(analysis, 'Local RAG did not return valid analysis');
  const report = { time:new Date().toISOString(), local:{role:health.role,indexDocuments:health.indexDocuments,emotion:analysis.emotion,hits:analysis.hits.length}, cloud:[] };
  if (process.argv.includes('--cloud')) {
    const server = createApp(process.env,new SessionStore());
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const base=`http://127.0.0.1:${server.address().port}`, c=client(base);
    try {
      assert.equal((await (await fetch(base+'/api/health')).json()).mode,'live','Configure the cloud model in .env');
      const memory=await (await c.request('/api/memories')).json();
      await c.request('/api/memories',{method:'POST',body:JSON.stringify({revision:memory.revision,action:'settings',capture:false})});
      for(const message of ['我担心明天的演示会忘词，心里很紧张，今天只想倾诉，不用建议。','I feel lonely after moving to a new city. I just want someone to listen, no advice.']) {
        const started=performance.now(); let firstDeltaMs, deltas=0, final, failure;
        const response=await c.request('/api/chat',{method:'POST',body:JSON.stringify({message})});assert.equal(response.status,200);
        const parser=createSSEParser(e=>{if(e.data==='[DONE]')return;const value=JSON.parse(e.data);
          if(value.type==='ai_delta'){firstDeltaMs??=Math.round(performance.now()-started);deltas++;}
          if(value.type==='ai_response')final=value;
          if(value.type==='error_message')failure=value.content;
        });
        const decoder=new TextDecoder();for await(const chunk of response.body)parser.feed(decoder.decode(chunk,{stream:true}));parser.feed(decoder.decode());parser.finish();
        assert.ok(final,failure||'Missing final response');assert.ok(deltas>0);assert.equal(final.backend,'cloud');
        assert.equal(final.rag.emotion.source,'local-trained-head');assert.equal(final.rag.direction.mode,'listen');
        assert.ok(['ready','no_matches'].includes(final.rag.status));
        report.cloud.push({language:/[\u3400-\u9fff]/.test(message)?'zh':'en',firstDeltaMs,totalMs:Math.round(performance.now()-started),deltas,ragStatus:final.rag.status,evidenceCount:final.rag.evidenceCount,direction:final.rag.direction.mode});
      }
    } finally {await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
  }
  fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync('artifacts/emotion-rag-live.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({passed:true,...report},null,2));
}
run().catch(error=>{console.error(error.message);process.exitCode=1;});
