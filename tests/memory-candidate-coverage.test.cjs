const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { once } = require('node:events');
const { emptyProfile, profileSchema, mutateMemory, retrieveMemories, DAY } = require('../dist/lib/memory');
const { retrievalRequest, validSemanticScores, boundedHistory } = require('../dist/lib/context/retrieval');
const { LocalKnowledge, MAX_PRIVATE_MEMORY_CANDIDATES } = require('../dist/lib/local-knowledge');

const now = Date.now();
function record(index, overrides = {}) {
  const text = index === 0 ? '我喜欢园艺，照料花草能让我放松' : `我收藏第${index}号折纸作品`;
  return { id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, kind: 'profile',
    key: `profile:fixture-${index}`, text, status: 'active', source: 'explicit', certainty: 'stated',
    createdAt: now - 20 * DAY, updatedAt: index === 0 ? now - 10 * DAY : now - index * 1000,
    expiresAt: now + 300 * DAY, reason: 'synthetic fixture',
    evidence: [{ sessionId: 'fixture-session', turnId: String(index), quote: text, at: now - 20 * DAY }],
    supersedes: [], ...overrides };
}
function profile(owner = 'fixture-owner') {
  return profileSchema.parse({ ...emptyProfile(owner), entries: Array.from({ length: 300 }, (_, i) => record(i)) });
}

test('history rejects future and invalid timestamps before they can anchor retrieval', () => {
  const pair = (timestamp, content) => [{ role: 'user', content, timestamp, memoryEpoch: 0 },
    { role: 'assistant', content: 'synthetic answer', timestamp, memoryEpoch: 0 }];
  const history = [...pair(new Date(now - 1000).toISOString(), '我正在准备论文'),
    ...pair(new Date(now + 1000).toISOString(), '未来的未发生记录'), ...pair('invalid timestamp', '无效时间记录')];
  const selected = boundedHistory(history, 0, now);
  assert.equal(selected.length, 2);
  const request = retrievalRequest('那接下来怎么办', emptyProfile('fixture-owner'), selected, now);
  assert.match(request.query, /准备论文/);
  assert.doesNotMatch(request.query, /未发生|无效时间/);
  assert.deepEqual(boundedHistory(pair(new Date(now + DAY).toISOString(), 'future'), 0, now), []);
});

test('semantic candidates cover all 300 eligible records, including an old cross-language match', () => {
  const p = profile(), input = 'Growing plants helps me relax', target = p.entries[0].id;
  const ranked = retrieveMemories(p, input, now, 12000);
  const oldCandidates = [...ranked, ...[...p.entries].sort((a, b) => b.updatedAt - a.updatedAt)]
    .filter((entry, index, entries) => entries.findIndex(other => other.id === entry.id) === index).slice(0, 80);
  assert.equal(oldCandidates.some(entry => entry.id === target), false, 'fixture must reproduce the previous blind spot');
  const request = retrievalRequest(input, p, []);
  assert.equal(request.memories.length, MAX_PRIVATE_MEMORY_CANDIDATES);
  assert.equal(request.candidateIds.size, 300);
  assert.ok(request.candidateIds.has(target));
  const hits = request.memories.map(entry => ({ id: entry.id, score: entry.id === target ? .95 : 0 }));
  const recalled = retrieveMemories(p, input, now, 1800, validSemanticScores(hits, request.candidateIds, p.entries));
  assert.equal(recalled[0].id, target);
  assert.ok(recalled.length <= 6, 'full local coverage must not expand the final cloud prompt');
});

test('all-candidate retrieval retains expiry, deletion, correction and recall-off boundaries', () => {
  let p = profile();
  p.entries[1].status = 'superseded'; p.entries[2].status = 'resolved'; p.entries[3].status = 'pending'; p.entries[4].expiresAt = now - 1;
  const target = p.entries[0].id, request = retrievalRequest('Growing plants helps me relax', p, []);
  assert.equal(request.memories.length, 296);
  for (const index of [1, 2, 3, 4]) assert.ok(!request.candidateIds.has(p.entries[index].id));
  const origin = { sessionId: 'fixture-session', turnId: 'edit', now };
  p = mutateMemory(p, { revision: p.revision, action: 'edit', id: target, kind: 'profile', text: '我喜欢游泳' }, origin);
  assert.ok(!retrievalRequest('Growing plants helps me relax', p, []).candidateIds.has(target));
  assert.equal(validSemanticScores([{ id: target, score: 1 }], request.candidateIds, p.entries).size, 0);
  const replacement = p.entries.find(entry => entry.text === '我喜欢游泳');
  assert.ok(replacement);
  p = mutateMemory(p, { revision: p.revision, action: 'delete', id: replacement.id }, origin);
  assert.ok(!retrievalRequest('swimming', p, []).candidateIds.has(replacement.id));
  p = mutateMemory(p, { revision: p.revision, action: 'settings', recall: false }, origin);
  assert.deepEqual(retrievalRequest('continue', p, []).memories, []);
});

test('candidate state is request-local and foreign record scores cannot enter another owner profile', () => {
  const a = profile('owner-a'), b = emptyProfile('owner-b');
  b.entries.push(record(301, { text: 'I enjoy painting' }));
  const requestA = retrievalRequest('gardening', a, []), requestB = retrievalRequest('painting', b, []);
  assert.equal(requestB.memories.length, 1);
  assert.equal(validSemanticScores([{ id: a.entries[0].id, score: 1 }], requestB.candidateIds, b.entries).size, 0);
  a.entries = [];
  assert.deepEqual(retrievalRequest('gardening', a, []).memories, []);
  assert.equal(requestA.memories.length, 300, 'earlier request data is not a shared mutable profile cache');
});

test('Node local adapter accepts 300 Unicode memory scores and rejects responses beyond the contract', async t => {
  let tooMany = false, received;
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    received = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const memory_hits = received.memories.map(({ id }) => ({ id, score: .75 }));
    if (tooMany) memory_hits.push({ id: record(400).id, score: .75 });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ emotion: 'joy', confidence: .8, scores: { joy: .8 }, label_source: 'local-trained-head', hits: [], index_size: 0, memory_hits }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const client = new LocalKnowledge({ LOCAL_ML_URL: `http://127.0.0.1:${server.address().port}` });
  const memories = profile().entries.map(({ id }) => ({ id, text: '情'.repeat(498) + '🌱' }));
  const result = await client.analyze('继续', undefined, { query: '继续', memories });
  assert.equal(result.memory_hits.length, 300);
  assert.deepEqual(received.memories, memories);
  tooMany = true;
  assert.equal(await client.analyze('继续', undefined, { query: '继续', memories }), undefined);
});
