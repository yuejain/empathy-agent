const { once } = require('node:events');
const { createServer } = require('node:http');
const { createApp } = require('../dist/server');
const { SessionStore } = require('../dist/server/session-store');
const { createSSEParser } = require('../src/sse');
async function listen(server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return `http://127.0.0.1:${server.address().port}`; }
async function close(server) { const closing = new Promise(resolve => server.close(resolve)); server.closeAllConnections(); await closing; }
async function app(t, env = { APP_MODE: 'demo', SESSION_PERSISTENCE: 'false' }, store) {
  const server = createApp(env, store || new SessionStore()); const url = await listen(server); t.after(() => close(server)); return { server, url };
}
function client(url, id = crypto.randomUUID()) {
  let cookie;
  return { id, async request(path, options = {}) {
    const r = await fetch(url + path, { ...options, headers: { 'makers-conversation-id': id, 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...options.headers } });
    if (r.headers.get('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0]; return r;
  }, async chat(message) { const r = await this.request('/api/chat', { method: 'POST', body: JSON.stringify({ message }) }); return { status: r.status, events: parse(await r.text()).filter(e=>e.type!=='ai_delta') }; },
  async state() { return (await this.request('/api/session')).json(); } };
}
function parse(text) { const events = []; const parser = createSSEParser(e => { if (e.data !== '[DONE]') events.push(JSON.parse(e.data)); }); parser.feed(text); parser.finish(); return events; }
async function provider(t, options = {}) {
  const requests = [];
  const server = createServer(async (req, res) => {
    if (options.localKnowledge && req.url==='/health') {
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,classifier:true,role:'emotion-rag',generator:false,index_documents:1}));return;
    }
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString()); requests.push({ path: req.url, auth: req.headers.authorization, body });
    if(options.localKnowledge && req.url==='/analyze') {
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(options.analysis || {emotion:'fear',confidence:.8,scores:{fear:.8},label_source:'local-trained-head',index_size:1,
        hits:[{id:'fixture',text:'工作压力与倾听',response:'先听你说。',source:'fixture-corpus',source_url:'https://example.org/corpus',license:'fixture',language:'zh',emotions:['fear'],category:'human-assistant',score:.8}]}));return;
    }
    if (options.delay) await new Promise(resolve => setTimeout(resolve, options.delay));
    if (res.destroyed) return;
    if (options.status) { res.writeHead(options.status); res.end('secret-key-do-not-leak'); return; }
    let content = '你提到工作带来的压力。最让你在意的是哪一部分？';
    const system = body.messages[0]?.content || '';
    if (system.includes('MEMORY_EXTRACTION')) content = JSON.stringify(options.memories || []);
    if (system.includes('分析文本中表达的情绪')) content = JSON.stringify({ primary_emotion: '焦虑', intensity: 0.4, confidence: 0.7, valence: -0.3, arousal: 0.5, dominance: 0.5, contextual_factors: [] });
    if (system.includes('评估文本中的安全风险')) content = JSON.stringify({ risk_level: 'L0', probabilities: { L0: .9, L1: .09, L2: .01 }, crisis_subtypes: { suicide_self_harm: 0, violence_others: 0, abuse: 0, acute_psychosis: 0, substance_abuse: 0, eating_disorder: 0, none: 1 }, confidence: .9 });
    if (options.content !== undefined) content = options.content;
    if (body.stream) {
      res.setHeader('Content-Type','text/event-stream'); res.flushHeaders();
      res.write('data: '+JSON.stringify({choices:[{delta:{reasoning_content:'PRIVATE_REASONING'},finish_reason:null}]})+'\n\n');
      for (const fragment of Array.from(content)) {
        if(res.destroyed) return;
        res.write('data: '+JSON.stringify({choices:[{delta:{content:fragment},finish_reason:null}]})+'\n\n');
        if(options.deltaDelay) await new Promise(resolve=>setTimeout(resolve,options.deltaDelay));
      }
      if(!options.truncated) res.write('data: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
      res.end(); return;
    }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
  const url = await listen(server); t.after(() => close(server));
  return { requests, env: { APP_MODE: 'live', AI_GATEWAY_BASE_URL: url + '/v1', AI_GATEWAY_MODEL: 'fixture-model', AI_GATEWAY_API_KEY: 'fixture-secret', AI_TIMEOUT_MS: String(options.timeout || 1000), SESSION_PERSISTENCE: 'false' } };
}
module.exports = { app, client, provider, parse };
