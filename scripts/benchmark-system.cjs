#!/usr/bin/env node
'use strict';

// Reproducible, synthetic-only benchmark. Never loads .env, private data or a real provider.
// npm run build && node --expose-gc scripts/benchmark-system.cjs --label before
// node --expose-gc scripts/benchmark-system.cjs --label after --compare artifacts/performance/before.json
// node --expose-gc scripts/benchmark-system.cjs --label sqlite --backend sqlite --python .venv-ml/Scripts/python.exe --compare artifacts/performance/before.json
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { createServer } = require('node:http');
const { once } = require('node:events');
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
function option(name, fallback) { const i = args.indexOf('--' + name); return i < 0 ? fallback : args[i + 1]; }
const label = option('label', 'current');
if (!/^[a-zA-Z0-9_-]{1,50}$/.test(label)) throw Error('Use a simple --label, for example before or after');
const samples = Number(option('samples', '12'));
if (!Number.isInteger(samples) || samples < 3 || samples > 60) throw Error('--samples must be an integer from 3 to 60');
const backend = option('backend', 'json');
if (!['json', 'sqlite'].includes(backend)) throw Error('--backend must be json or sqlite');
const pythonExecutable = option('python');
const runtime = path.resolve(root, option('runtime', 'dist'));
const { createApp } = require(path.join(runtime, 'server'));
const { SessionStore } = require(path.join(runtime, 'server/session-store'));
const { ConversationOrchestrator } = require(path.join(runtime, 'lib/orchestrator'));
const { emptyProfile } = require(path.join(runtime, 'lib/memory'));
const { createSSEParser } = require('../src/sse');
const outputDir = path.join(root, 'artifacts/performance');
fs.mkdirSync(outputDir, { recursive: true });
const fixtureDir = fs.mkdtempSync(path.join(outputDir, `${label}-fixtures-`));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const round = value => Number(value.toFixed(3));
function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return { samples: 0 };
  const quantile = q => sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)];
  return { samples: sorted.length, minMs: round(sorted[0]), p50Ms: round(quantile(.5)), p95Ms: round(quantile(.95)), maxMs: round(sorted.at(-1)), meanMs: round(sorted.reduce((a, b) => a + b, 0) / sorted.length) };
}
function uuid(seed) {
  const hex = createHash('sha256').update(String(seed)).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
const ownerId = n => uuid(`benchmark-owner-${n}`);
const sessionId = n => uuid(`benchmark-session-${n}`);
function fixture(baseState, owners, entries) {
  const now = Date.now();
  const profiles = [], sessions = [];
  for (let i = 0; i < owners; i++) {
    const owner = ownerId(i), id = sessionId(i);
    const profile = emptyProfile(owner);
    profile.entries = Array.from({ length: entries }, (_, j) => {
      const text = `我正在整理研究项目 ${j} 的演示资料，计划按自己的节奏完成，每个项目都是独立的合成基准事项。`;
      return { id: uuid(`memory-${i}-${j}`), kind: 'activity', key: `activity:research-${j}`, text,
        status: 'active', source: 'statement', certainty: 'stated', createdAt: now, updatedAt: now,
        expiresAt: now + 30 * 86400000, reason: 'Synthetic benchmark fixture', supersedes: [],
        evidence: [{ sessionId: id, turnId: '1', quote: text, at: now }], progress: 'in_progress' };
    });
    profiles.push(profile);
    const state = structuredClone(baseState);
    Object.assign(state, { userId: owner, sessionId: `${owner}:${id}`, turnCount: 10, currentState: 'EMPATHY_PHASE' });
    state.recentHistory = Array.from({ length: 20 }, (_, j) => ({ role: j % 2 ? 'assistant' : 'user', content: j % 2 ? '我们可以先看你在意的部分。'.repeat(8) : '这只是合成测试对话，我想梳理研究项目的进展。'.repeat(6), timestamp: new Date(now).toISOString(), memoryEpoch: 0 }));
    sessions.push({ owner, id, state, updatedAt: now });
  }
  return { version: 2, profiles, sessions };
}
async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}
async function close(server) {
  if (!server?.listening) return;
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
}

// All preparation branches deliberately overlap; the trace detects accidental serialisation.
async function mockProvider() {
  const traces = [];
  const delays = { safety: 35, analysis: 45, retrieval: 25, generation: 15, chunk: 3 };
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (req.url === '/health') { res.end(JSON.stringify({ ok: true, classifier: true, index_documents: 4000 })); return; }
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    const system = body.messages?.[0]?.content || '';
    const kind = req.url === '/analyze' ? 'retrieval' : body.stream ? 'generation' : system.includes('TURN_ANALYSIS') ? 'analysis' : system.includes('评估文本中的安全风险') ? 'safety' : 'unexpected';
    const trace = { kind, startedMs: performance.now(), endedMs: null, bytes: chunks.reduce((sum, x) => sum + x.length, 0) };
    traces.push(trace);
    await delay(delays[kind] || 0);
    if (kind === 'retrieval') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ emotion: 'fear', confidence: .8, scores: { fear: .8 }, label_source: 'local-trained-head', index_size: 4000,
        memory_hits: (body.memories || []).map((item, i) => ({ id: item.id, score: Math.max(.1, .9 - i / 100) })),
        timings: { encodeMs: 20, searchMs: 5 }, hits: [{ id: 'synthetic', text: '对研究项目的担心与倾听', response: '先梳理当前感受。', source: 'synthetic-benchmark', source_url: 'https://example.org/synthetic', license: 'Synthetic fixture', language: 'zh', emotions: ['fear'], category: 'human-assistant', score: .8 }] }));
    } else if (kind === 'generation') {
      res.setHeader('Content-Type', 'text/event-stream'); res.flushHeaders();
      const content = '你提到研究项目带来的压力，我们可以慢慢梳理目前最让你在意的部分。现在最想先说说哪件事？';
      for (let i = 0; i < content.length; i += 5) {
        if (res.destroyed) break;
        res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: content.slice(i, i + 5) }, finish_reason: null }] }) + '\n\n');
        await delay(delays.chunk);
      }
      res.end('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
    } else {
      const content = kind === 'analysis' ? { memories: [], experiments: [], affect: [], intent: { intent: 'L2.1_emotional_venting', confidence: .95, quote: body.messages.at(-1).content } }
        : { risk_level: 'L0', probabilities: { L0: .9, L1: .09, L2: .01 }, crisis_subtypes: { suicide_self_harm: 0, violence_others: 0, abuse: 0, acute_psychosis: 0, substance_abuse: 0, eating_disorder: 0, none: 1 }, confidence: .9 };
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }));
    }
    trace.endedMs = performance.now();
  });
  const url = await listen(server);
  return { server, traces, delays, env: { APP_MODE: 'live', SESSION_PERSISTENCE: 'false', AI_GATEWAY_BASE_URL: url + '/v1', AI_GATEWAY_MODEL: 'synthetic-benchmark', AI_GATEWAY_API_KEY: 'synthetic-fixture-value', AI_TIMEOUT_MS: '5000', LOCAL_ML_URL: url } };
}
async function chat(url, ownerIndex) {
  const start = performance.now();
  const response = await fetch(url + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: `empathy-owner=${ownerId(ownerIndex)}`, 'makers-conversation-id': sessionId(ownerIndex) }, body: JSON.stringify({ message: '我担心研究项目的进展，今天想先说说自己的感受。' }) });
  assert.equal(response.status, 200);
  const headersMs = performance.now() - start;
  let firstDeltaMs, finalMs, final, text = '', deltas = 0;
  const parser = createSSEParser(event => {
    if (event.data === '[DONE]') return;
    const data = JSON.parse(event.data);
    assert.notEqual(data.type, 'error_message', data.content);
    if (data.type === 'ai_delta') { firstDeltaMs ??= performance.now() - start; text += data.content; deltas++; }
    if (data.type === 'ai_response') { finalMs = performance.now() - start; final = data; }
  });
  const decoder = new TextDecoder();
  for await (const chunk of response.body) parser.feed(decoder.decode(chunk, { stream: true }));
  parser.feed(decoder.decode()); parser.finish();
  assert.ok(final && firstDeltaMs !== undefined && deltas > 1, 'Streaming and final response are required');
  assert.equal(text, final.content);
  assert.equal(final.backend, 'cloud');
  assert.equal(final.retrieval.mode, 'semantic-hybrid');
  return { headersMs, firstDeltaMs, totalMs: performance.now() - start, finalMs, deltas, timings: final.timings, bytes: Buffer.byteLength(text) };
}
function traceSummary(traces) {
  const counts = {}, bytes = {};
  for (const trace of traces) { counts[trace.kind] = (counts[trace.kind] || 0) + 1; bytes[trace.kind] = (bytes[trace.kind] || 0) + trace.bytes; }
  const events = traces.filter(t => t.kind !== 'generation').flatMap(t => [[t.startedMs, 1], [t.endedMs, -1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let active = 0, peak = 0;
  for (const [, change] of events) { active += change; peak = Math.max(peak, active); }
  return { counts, requestBytes: bytes, peakPreparationRequests: peak };
}
function chatSummary(values) {
  const result = {};
  for (const key of ['headersMs', 'firstDeltaMs', 'totalMs', 'finalMs']) result[key] = summary(values.map(v => v[key]));
  result.stages = Object.fromEntries([...new Set(values.flatMap(v => Object.keys(v.timings || {})))].map(key => [key, summary(values.map(v => v.timings?.[key]).filter(Number.isFinite))]));
  return result;
}
function loopSummary(histogram) { return { resolutionMs: 10, p50Ms: round(histogram.percentile(50) / 1e6), p95Ms: round(histogram.percentile(95) / 1e6), maxMs: round(histogram.max / 1e6) }; }
function persistentStore(file) { return new SessionStore(file, undefined, undefined, { backend, ...(pythonExecutable ? { pythonExecutable } : {}) }); }
function storageSize(file) {
  if (backend === 'json') return fs.statSync(file).size;
  const database = file.replace(/\.json$/, '.sqlite3');
  assert.ok(fs.existsSync(database), 'SQLite benchmark must create a real SQLite file, not silently use JSON');
  return [database, database + '-wal', database + '-shm'].reduce((sum, item) => sum + (fs.existsSync(item) ? fs.statSync(item).size : 0), 0);
}
async function measureHttp(provider, baseState, owners) {
  const file = path.join(fixtureDir, `http-${owners}.json`);
  const seed = fixture(baseState, Math.max(owners, 4), 80);
  if (owners) fs.writeFileSync(file, JSON.stringify(seed));
  const store = owners ? persistentStore(file) : new SessionStore();
  await store.ready;
  if (!owners) for (const p of seed.profiles) await store.setMemory(p.owner, p, 0);
  const server = createApp(provider.env, store);
  let report;
  try {
    const url = await listen(server);
    await chat(url, 0); // Warm caches, TCP and V8; omitted from measurements.
    const statics = [];
    for (const asset of ['/', '/app.js', '/styles.css']) {
      const times = []; let bytes, cacheControl, etag, conditionalStatus;
      for (let i = 0; i <= samples; i++) {
        const start = performance.now(), response = await fetch(url + asset);
        assert.equal(response.status, 200); bytes = (await response.arrayBuffer()).byteLength;
        cacheControl = response.headers.get('cache-control'); etag = response.headers.get('etag');
        if (i) times.push(performance.now() - start);
      }
      if (etag) { const response = await fetch(url + asset, { headers: { 'If-None-Match': etag } }); conditionalStatus = response.status; await response.arrayBuffer(); }
      statics.push({ asset, bytes, cacheControl, etagPresent: !!etag, conditionalStatus, ...summary(times) });
    }
    global.gc?.(); // Optional --expose-gc: remove garbage left by fixture migration before measuring.
    const traceStart = provider.traces.length, cpuStart = process.cpuUsage(), memoryStart = process.memoryUsage();
    const histogram = monitorEventLoopDelay({ resolution: 10 }); histogram.enable();
    const values = [];
    const start = performance.now();
    for (let i = 0; i < samples; i++) values.push(await chat(url, i % 4));
    const sequentialWall = performance.now() - start;
    const sequentialTraceEnd = provider.traces.length;
    const concurrent = [];
    const concurrentStart = performance.now();
    // Four independent browser owners, three waves: bounded by supported admission limits.
    for (let wave = 0; wave < 3; wave++) concurrent.push(...await Promise.all([0, 1, 2, 3].map(i => chat(url, i))));
    const concurrentWall = performance.now() - concurrentStart;
    histogram.disable();
    const memoryEnd = process.memoryUsage();
    report = { backend: owners ? backend : 'memory', persistedOwners: owners, entriesPerOwner: 80, snapshotBytes: owners ? fs.statSync(file).size : 0, storageBytes: owners ? storageSize(file) : 0, static: statics,
      sequential: { ...chatSummary(values), requestsPerSecond: round(samples * 1000 / sequentialWall), protocol: traceSummary(provider.traces.slice(traceStart, sequentialTraceEnd)) },
      concurrent: { clients: 4, ...chatSummary(concurrent), requestsPerSecond: round(concurrent.length * 1000 / concurrentWall), protocol: traceSummary(provider.traces.slice(sequentialTraceEnd)) },
      eventLoop: loopSummary(histogram), cpuMs: Object.fromEntries(Object.entries(process.cpuUsage(cpuStart)).map(([key, value]) => [key, round(value / 1000)])),
      memory: { rssStartBytes: memoryStart.rss, rssEndBytes: memoryEnd.rss, heapStartBytes: memoryStart.heapUsed, heapEndBytes: memoryEnd.heapUsed } };
  } finally { await close(server); if (typeof store.close === 'function') await store.close(); }
  return report;
}
async function measurePersistence(baseState, owners) {
  const file = path.join(fixtureDir, `store-${owners}.json`);
  fs.writeFileSync(file, JSON.stringify(fixture(baseState, owners, 80)));
  const bytes = fs.statSync(file).size, start = performance.now(), store = persistentStore(file);
  await store.ready;
  const loadMs = performance.now() - start;
  const save = [], read = [], timers = [];
  try {
    for (let i = 0; i <= samples; i++) {
      const owner = ownerId(i % owners), id = sessionId(i % owners);
      const readStart = performance.now(), state = store.get(owner, id), profile = store.getMemory(owner);
      const readMs = performance.now() - readStart;
      const probeStart = performance.now();
      const probe = new Promise(resolve => setTimeout(() => resolve(performance.now() - probeStart), 0));
      const saveStart = performance.now();
      await store.set(owner, id, state, profile, profile.revision);
      const saveMs = performance.now() - saveStart, timerMs = await probe;
      if (i) { read.push(readMs); save.push(saveMs); timers.push(timerMs); }
    }
  } finally { if (typeof store.close === 'function') await store.close(); }
  const restartStart = performance.now(), reopened = persistentStore(file);
  await reopened.ready;
  const restartMs = performance.now() - restartStart;
  assert.equal(reopened.getMemory(ownerId(0)).entries.length, 80, 'Successful commits must survive restart');
  if (typeof reopened.close === 'function') await reopened.close();
  return { backend, owners, entriesPerOwner: 80, snapshotBytes: bytes, storageBytes: storageSize(file), startupMs: round(loadMs), restartMs: round(restartMs), read: summary(read), commit: summary(save), timerProbe: summary(timers) };
}
function comparison(before, after) {
  const rows = [];
  function row(metric, a, b) { if (typeof a === 'number' && typeof b === 'number') rows.push({ metric, before: a, after: b, changePercent: a ? round(100 * (b - a) / a) : null }); }
  for (const item of after.persistence) {
    const old = before.persistence.find(p => p.owners === item.owners);
    if (old) for (const key of ['commit', 'timerProbe', 'read']) row(`store.${item.owners}.${key}.p50Ms`, old[key].p50Ms, item[key].p50Ms);
  }
  for (const item of after.http) {
    const old = before.http.find(p => p.persistedOwners === item.persistedOwners);
    if (!old) continue;
    for (const mode of ['sequential', 'concurrent']) for (const key of ['firstDeltaMs', 'totalMs']) row(`http.${item.persistedOwners}.${mode}.${key}.p50Ms`, old[mode][key].p50Ms, item[mode][key].p50Ms);
    row(`http.${item.persistedOwners}.eventLoop.p95Ms`, old.eventLoop.p95Ms, item.eventLoop.p95Ms);
  }
  return rows;
}
function runtimeFingerprint(directory) {
  const digest = createHash('sha256');
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && entry.name.endsWith('.js')) digest.update(path.relative(directory, file).replace(/\\/g, '/')).update('\0').update(fs.readFileSync(file));
    }
  }
  visit(directory);
  return digest.digest('hex');
}
async function main() {
  const demo = new ConversationOrchestrator({ APP_MODE: 'demo' });
  const result = await demo.processTurn({ userId: 'synthetic-seed', sessionId: 'synthetic-seed:session', userInput: '我想整理研究项目的感受。' });
  let revision;
  try { revision = execFileSync('git', ['-c', `safe.directory=${root.replace(/\\/g, '/')}`, 'rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); } catch { revision = 'unavailable'; }
  const report = { schema: 1, label, at: new Date().toISOString(), revision, runtime: path.relative(root, runtime), runtimeSha256: runtimeFingerprint(runtime), node: process.version,
    platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model, samples, warmups: 1, backend, explicitGcBeforeCases: typeof global.gc === 'function',
    scope: 'Synthetic loopback provider and RAG; excludes real cloud latency, model encoding and browser rendering. Same-process mock overhead and OS scheduling are included. No .env or private sessions are loaded. Timing numbers are descriptive, never test assertions.',
    persistence: [], http: [] };
  for (const owners of [1, 50, 200]) { global.gc?.(); report.persistence.push(await measurePersistence(result.updatedState, owners)); }
  const provider = await mockProvider();
  try { report.simulatedDelaysMs = provider.delays; for (const owners of [0, 200]) report.http.push(await measureHttp(provider, result.updatedState, owners)); }
  finally { await close(provider.server); }
  const comparePath = option('compare');
  if (comparePath) report.comparison = comparison(JSON.parse(fs.readFileSync(path.resolve(root, comparePath), 'utf8')), report);
  const output = path.join(outputDir, label + '.json');
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output: path.relative(root, output), revision, persistence: report.persistence.map(p => ({ owners: p.owners, snapshotBytes: p.snapshotBytes, commitP50Ms: p.commit.p50Ms, timerProbeP95Ms: p.timerProbe.p95Ms })), http: report.http.map(h => ({ owners: h.persistedOwners, firstDeltaP50Ms: h.sequential.firstDeltaMs.p50Ms, totalP50Ms: h.sequential.totalMs.p50Ms, concurrentRps: h.concurrent.requestsPerSecond, eventLoopP95Ms: h.eventLoop.p95Ms, calls: h.sequential.protocol.counts, parallelPrep: h.sequential.protocol.peakPreparationRequests })), comparison: report.comparison }, null, 2));
}
main().catch(error => {
  fs.writeFileSync(path.join(outputDir, label + '-failed.json'), JSON.stringify({ label, at: new Date().toISOString(), runtime: path.relative(root, runtime), backend, scope: 'Synthetic fixtures only; run did not complete', error: error.stack || String(error) }, null, 2));
  console.error(error.stack || error.message); process.exitCode = 1;
});
