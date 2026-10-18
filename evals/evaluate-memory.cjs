// Synthetic-only adapter for the production candidate and final memory retrieval code.
// --prepare emits requests; --score consumes [{id,memory_hits}] from stdin. No .env or sessions.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { z } = require('zod');
const { emptyProfile, profileSchema, retrieveMemories, eligible, DAY } = require('../dist/lib/memory');
const { retrievalRequest, validSemanticScores } = require('../dist/lib/context/retrieval');

const file = path.join(__dirname, 'memory-retrieval.json');
const bytes = fs.readFileSync(file);
const uuid = z.string().uuid(), probability = z.number().finite().min(0).max(1);
const manifest = z.object({ schemaVersion: z.literal(1), fixture: z.literal('memory-retrieval.json'), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  cases: z.number().int().min(2), languages: z.tuple([z.literal('zh'), z.literal('en')]), policy: z.string().min(20) }).strict()
  .parse(JSON.parse(fs.readFileSync(path.join(__dirname, 'memory-retrieval.manifest.json'), 'utf8')));
if (crypto.createHash('sha256').update(bytes).digest('hex') !== manifest.sha256) throw new Error('Frozen memory fixture hash mismatch; version judgments before changing them');
const recordSchema = z.object({ id: z.string().min(1).max(80), text: z.string().min(1).max(500),
  kind: z.enum(['emotion', 'activity', 'decision', 'profile']), ageDays: z.number().finite().min(0).max(365),
  status: z.enum(['active', 'pending', 'resolved', 'superseded']).optional(), expired: z.boolean().optional(), deleted: z.boolean().optional() }).strict();
const fixtureSchema = z.object({ schemaVersion: z.literal(1), provenance: z.string().min(20), now: z.string().datetime(), k: z.literal(6),
  cases: z.array(z.object({ id: z.string().min(1).max(80), language: z.enum(['zh', 'en']), query: z.string().min(1).max(2000),
    tags: z.array(z.string().min(1)).min(1), fillers: z.number().int().min(0).max(299), recall: z.boolean().optional(),
    memories: z.array(recordSchema).min(1).max(300), relevantIds: z.array(z.string()).max(300), forbiddenIds: z.array(z.string()).max(300) }).strict()).min(2) }).strict();
const fixture = fixtureSchema.parse(JSON.parse(bytes.toString('utf8')));
if (fixture.cases.length !== manifest.cases || new Set(fixture.cases.map(entry => entry.id)).size !== fixture.cases.length || !manifest.languages.every(language => fixture.cases.some(entry => entry.language === language))) throw new Error('Invalid case identities or languages');
for (const entry of fixture.cases) {
  const aliases = new Set(entry.memories.map(record => record.id));
  if (aliases.size !== entry.memories.length || [...entry.relevantIds, ...entry.forbiddenIds].some(id => !aliases.has(id)) ||
      new Set([...entry.relevantIds, ...entry.forbiddenIds]).size !== entry.relevantIds.length + entry.forbiddenIds.length) throw new Error('Invalid gold identities');
}
const now = Date.parse(fixture.now);
const idFor = (caseId, alias) => {
  const hex = crypto.createHash('sha256').update(`${caseId}:${alias}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
function prepare(entry) {
  const p = emptyProfile(`synthetic:${entry.id}`);
  p.settings.recall = entry.recall !== false;
  const make = record => {
    const updatedAt = now - (record.ageDays || 0) * DAY;
    return { id: idFor(entry.id, record.id), kind: record.kind, key: `${record.kind}:fixture:${record.id}`,
      text: record.text, status: record.status || 'active', source: 'explicit', certainty: 'stated',
      createdAt: updatedAt, updatedAt, expiresAt: record.expired ? now - 1 : now + 365 * DAY,
      reason: 'synthetic evaluation fixture', evidence: [{sessionId: `fixture:${entry.id}`, turnId: record.id, quote: record.text, at: updatedAt}], supersedes: [] };
  };
  p.entries = entry.memories.filter(record => !record.deleted).map(make);
  for (let index = 0; index < entry.fillers; index++) {
    p.entries.push(make({ id: `filler-${index}`, kind: 'profile', ageDays: index / 10000,
      text: index % 2 ? `我收藏第${index}号折纸作品。` : `My numbered paper-folding collection contains item ${index}.` }));
  }
  const profile = profileSchema.parse(p);
  const request = retrievalRequest(entry.query, profile, [], now);
  const legacyMemories = request.memories.slice(0, 80);
  const legacyRequest = { ...request, memories: legacyMemories, candidateIds: new Set(legacyMemories.map(record => record.id)) };
  return { entry, profile, request, legacyRequest, relevantIds: entry.relevantIds.map(alias => idFor(entry.id, alias)),
    forbiddenIds: entry.forbiddenIds.map(alias => idFor(entry.id, alias)) };
}
const prepared = fixture.cases.map(prepare);
function aggregate(rows) {
  const positives = rows.filter(row => row.relevantIds.length);
  const negatives = rows.filter(row => !row.relevantIds.length);
  const mean = (items, key) => items.length ? items.reduce((sum, item) => sum + item[key], 0) / items.length : null;
  const returnedHits = rows.reduce((sum, row) => sum + row.returnedHits, 0);
  const relevantHits = rows.reduce((sum, row) => sum + row.relevantHits, 0);
  const falsePositiveHits = returnedHits - relevantHits;
  return { cases: rows.length, positiveCases: positives.length, negativeCases: negatives.length,
    recallAt6: mean(positives, 'recallAt6'), mrr: mean(positives, 'reciprocalRank'),
    forbiddenHitRate: mean(rows, 'forbiddenHit'), negativeRecallRate: mean(negatives, 'negativeRecall'),
    candidateRecall: mean(positives, 'candidateRecall'), returnedHits, relevantHits, falsePositiveHits,
    precisionAtReturned: returnedHits ? relevantHits / returnedHits : null,
    falsePositiveHitRate: returnedHits ? falsePositiveHits / returnedHits : null };
}
function rowResult(prepared, request, orderedRetrievedIds) {
  const { entry, relevantIds, forbiddenIds } = prepared;
  const first = orderedRetrievedIds.findIndex(id => relevantIds.includes(id));
  const relevantHits = orderedRetrievedIds.filter(id => relevantIds.includes(id)).length;
  return { id: entry.id, language: entry.language, tags: entry.tags, candidates: request.memories.length,
    relevantIds, forbiddenIds, orderedRetrievedIds,
    recallAt6: relevantIds.length ? relevantIds.filter(id => orderedRetrievedIds.includes(id)).length / relevantIds.length : null,
    reciprocalRank: first < 0 ? 0 : 1 / (first + 1),
    forbiddenHit: Number(orderedRetrievedIds.some(id => forbiddenIds.includes(id))),
    negativeRecall: Number(!relevantIds.length && orderedRetrievedIds.length > 0),
    candidateRecall: relevantIds.length ? relevantIds.filter(id => request.candidateIds.has(id)).length / relevantIds.length : null,
    returnedHits: orderedRetrievedIds.length, relevantHits, falsePositiveHits: orderedRetrievedIds.length - relevantHits };
}
const metricsSchema = z.object({ cases: z.number().int().nonnegative(), positiveCases: z.number().int().nonnegative(), negativeCases: z.number().int().nonnegative(),
  recallAt6: probability.nullable(), mrr: probability.nullable(), forbiddenHitRate: probability.nullable(), negativeRecallRate: probability.nullable(), candidateRecall: probability.nullable(),
  returnedHits: z.number().int().nonnegative(), relevantHits: z.number().int().nonnegative(), falsePositiveHits: z.number().int().nonnegative(),
  precisionAtReturned: probability.nullable(), falsePositiveHitRate: probability.nullable() }).strict();
const caseSchema = z.object({ id: z.string(), language: z.enum(['zh', 'en']), tags: z.array(z.string()), candidates: z.number().int().min(0).max(300),
  relevantIds: z.array(uuid).max(300), forbiddenIds: z.array(uuid).max(300), orderedRetrievedIds: z.array(uuid).max(6),
  recallAt6: probability.nullable(), reciprocalRank: probability, forbiddenHit: z.union([z.literal(0), z.literal(1)]),
  negativeRecall: z.union([z.literal(0), z.literal(1)]), candidateRecall: probability.nullable(),
  returnedHits: z.number().int().min(0).max(6), relevantHits: z.number().int().min(0).max(6), falsePositiveHits: z.number().int().min(0).max(6) }).strict();
const resultsSchema = z.object({ overall: metricsSchema, byLanguage: z.object({ zh: metricsSchema, en: metricsSchema }).strict(), cases: z.array(caseSchema) }).strict();
const reportSchema = resultsSchema.extend({ fixtureSha256: z.string().regex(/^[a-f0-9]{64}$/), provenance: z.string(), now: z.string().datetime(), k: z.literal(6), legacy80: resultsSchema }).strict();
function summarize(cases) {
  return { overall: aggregate(cases), byLanguage: Object.fromEntries(['zh', 'en'].map(language => [language, aggregate(cases.filter(row => row.language === language))])), cases };
}
function validateReport(raw) {
  const report = reportSchema.parse(raw);
  if (report.fixtureSha256 !== crypto.createHash('sha256').update(bytes).digest('hex') || report.provenance !== fixture.provenance || report.now !== fixture.now) throw new Error('Report does not match frozen fixture');
  for (const [results, legacy] of [[report, false], [report.legacy80, true]]) {
    if (results.cases.length !== prepared.length || new Set(results.cases.map(row => row.id)).size !== prepared.length) throw new Error('Missing or duplicate report case');
    for (const row of results.cases) {
      const expected = prepared.find(value => value.entry.id === row.id);
      if (!expected) throw new Error('Unknown report case');
      const request = legacy ? expected.legacyRequest : expected.request;
      const allowed = new Set(expected.profile.settings.recall ? expected.profile.entries.filter(record => eligible(record, now)).map(record => record.id) : []);
      if (new Set(row.orderedRetrievedIds).size !== row.orderedRetrievedIds.length || row.orderedRetrievedIds.some(id => !allowed.has(id))) throw new Error('Unknown, ineligible or duplicate retrieved record');
      if (JSON.stringify(row) !== JSON.stringify(rowResult(expected, request, row.orderedRetrievedIds))) throw new Error('Inconsistent per-case metrics');
    }
    const computed = summarize(results.cases);
    if (JSON.stringify(results.overall) !== JSON.stringify(computed.overall) || JSON.stringify(results.byLanguage) !== JSON.stringify(computed.byLanguage)) throw new Error('Inconsistent aggregate metrics');
  }
  return report;
}
function score(responses) {
  responses = z.array(z.object({ id: z.string(), memory_hits: z.array(z.object({ id: uuid, score: z.number().finite().min(-1).max(1) }).strict()).max(300) }).strict()).parse(responses);
  if (!Array.isArray(responses) || responses.length !== prepared.length) throw new Error('Every frozen case needs exactly one response');
  const byId = new Map(responses.map(response => [response.id, response]));
  if (byId.size !== prepared.length || [...byId.keys()].some(id => !prepared.some(row => row.entry.id === id))) throw new Error('Unknown or duplicate case');
  for (const { entry, request } of prepared) {
    const hits = byId.get(entry.id).memory_hits;
    if (hits.length !== request.memories.length || new Set(hits.map(hit => hit.id)).size !== hits.length || hits.some(hit => !request.candidateIds.has(hit.id))) throw new Error('Missing, unknown or duplicate memory score');
  }
  const retrieve = (item, legacy) => {
    const { entry, profile } = item, request = legacy ? item.legacyRequest : item.request;
    const hits = byId.get(entry.id).memory_hits;
    const semantic = validSemanticScores(hits, request.candidateIds, profile.entries, now);
    const orderedRetrievedIds = retrieveMemories(profile, entry.query, now, 1800, semantic).map(record => record.id);
    return rowResult(item, request, orderedRetrievedIds);
  };
  const cases = prepared.map(item => retrieve(item, false));
  return validateReport({ ...summarize(cases), fixtureSha256: crypto.createHash('sha256').update(bytes).digest('hex'), provenance: fixture.provenance,
    now: fixture.now, k: fixture.k, legacy80: summarize(prepared.map(item => retrieve(item, true))) });
}
if (require.main === module) try {
if (process.argv[2] === '--prepare') {
  process.stdout.write(JSON.stringify(prepared.map(({ entry, request, relevantIds, forbiddenIds }) => ({
    id: entry.id, language: entry.language, tags: entry.tags, relevantIds, forbiddenIds,
    request: { text: request.text, query: request.query, memories: request.memories }
  }))));
} else if (process.argv[2] === '--score') {
  process.stdout.write(JSON.stringify(score(JSON.parse(fs.readFileSync(0, 'utf8')))));
} else {
  process.stderr.write('Use --prepare or --score. Only frozen synthetic cases are supported.\n');
  process.exitCode = 2;
}
} catch { process.stderr.write('Memory evaluation failed: invalid fixture, scores, or report.\n'); process.exitCode = 1; }
module.exports = { prepareCases: () => prepared, score, validateReport };
