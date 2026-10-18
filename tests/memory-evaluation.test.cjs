const test = require('node:test');
const assert = require('node:assert/strict');
const { prepareCases, score, validateReport } = require('../evals/evaluate-memory.cjs');

function responses() {
  return prepareCases().map(item => ({ id: item.entry.id,
    memory_hits: item.request.memories.map(record => ({ id: record.id, score: item.relevantIds.includes(record.id) ? .95 : 0 })) }));
}

test('frozen memory evaluation measures final retrieval, language partitions and the legacy 80-candidate baseline', () => {
  const report = score(responses());
  assert.equal(report.overall.cases, 12);
  assert.equal(report.byLanguage.zh.cases, 6); assert.equal(report.byLanguage.en.cases, 6);
  assert.equal(report.overall.candidateRecall, 1);
  assert.equal(report.overall.recallAt6, 1);
  assert.equal(report.overall.forbiddenHitRate, 0);
  assert.equal(report.overall.returnedHits, report.overall.relevantHits + report.overall.falsePositiveHits);
  assert.equal(report.overall.precisionAtReturned, report.overall.relevantHits / report.overall.returnedHits);
  assert.ok(report.legacy80.overall.candidateRecall < 1);
  assert.ok(report.legacy80.overall.recallAt6 < report.overall.recallAt6);
  assert.deepEqual(validateReport(report), report);
});

test('memory evaluation rejects missing cases, duplicate or unknown records and non-finite scores', () => {
  const mutations = [
    values => values.pop(),
    values => { values[1].id = values[0].id; },
    values => { values[0].id = 'unknown-case'; },
    values => values[0].memory_hits.pop(),
    values => { values[0].memory_hits[1].id = values[0].memory_hits[0].id; },
    values => { values[0].memory_hits[0].id = 'ffffffff-ffff-4fff-8fff-ffffffffffff'; },
    values => { values[0].memory_hits[0].score = NaN; },
    values => { values[0].memory_hits[0].score = Infinity; },
  ];
  for (const mutate of mutations) { const values = responses(); mutate(values); assert.throws(() => score(values)); }
});

test('memory report validation checks gold identity, language coverage and recomputed metrics', () => {
  const original = score(responses());
  const mutations = [
    report => { delete report.byLanguage.zh; },
    report => { report.overall.mrr = NaN; },
    report => { report.overall.recallAt6 = 0; },
    report => { report.overall.falsePositiveHitRate = 1; },
    report => { report.cases[0].relevantIds = []; },
    report => { report.cases[0].orderedRetrievedIds = ['ffffffff-ffff-4fff-8fff-ffffffffffff']; },
    report => report.cases.pop(),
    report => { report.cases[1].id = report.cases[0].id; },
    report => { report.fixtureSha256 = '0'.repeat(64); },
  ];
  for (const mutate of mutations) { const report = structuredClone(original); mutate(report); assert.throws(() => validateReport(report)); }
});
