"""Reproducible public retrieval benchmark; --real also measures existing offline models.

Uses constructed texts only. Does not read sessions, .env, download models, or call cloud APIs.
Prints JSON; no private vectors or corpus text are written to the report.
"""
import argparse
import json
import statistics
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import numpy as np

from retrieval import PublicIndex, lexical


def legacy_search(index, query, vector, detected):
    terms = lexical(query)
    cosine = index.vectors @ vector
    rankings = []
    for i, document in enumerate(index.documents):
        overlap = len(terms & index.tokens[i]) / max(1, len(terms))
        affect = len(set(document['emotions']) & set(detected)) / max(1, len(detected))
        score = .75*float(cosine[i]) + .15*overlap + .1*affect
        if len(query) >= 8 and affect > 0 and cosine[i] >= .35 and score >= .38:
            rankings.append((score, i))
    rankings.sort(reverse=True)
    hits, groups = [], set()
    for score, i in rankings:
        document = index.documents[i]
        if document['group'] in groups:
            continue
        groups.add(document['group'])
        hits.append({'id': document['id'], 'score': round(score, 4)})
        if len(hits) == 3:
            break
    return hits


def timed(call, samples):
    call()
    values = []
    for _ in range(samples):
        start = time.perf_counter()
        call()
        values.append((time.perf_counter() - start) * 1000)
    return {'medianMs': round(statistics.median(values), 3), 'p95Ms': round(float(np.percentile(values, 95)), 3), 'samples': samples}


def benchmark(samples, real):
    random = np.random.default_rng(42)
    vector = random.normal(size=384).astype(np.float32)
    vector /= np.linalg.norm(vector)
    vectors = random.normal(size=(4000, 384)).astype(np.float32) * .035 + vector
    vectors /= np.linalg.norm(vectors, axis=1, keepdims=True)
    documents = [dict(id=str(i), text='work anxiety 工作 焦虑 decision ' + str(i), response='fixture', source='fixture',
        source_url='https://example.org', license='fixture', language='en', emotions=['fear'], category='fixture', group=str(i // 2)) for i in range(4000)]
    index = PublicIndex(documents, vectors)
    query = 'work anxiety 工作 焦虑 decision'
    old = legacy_search(index, query, vector, ['fear'])
    new = [{'id': hit['id'], 'score': hit['score']} for hit in index.search(query, vector, ['fear'])]
    if old != new:
        raise AssertionError('Optimized retrieval differs from baseline')
    report = {'fixture': {'documents': 4000, 'dimensions': 384, 'seed': 42, 'matching_results': True,
        'legacy': timed(lambda: legacy_search(index, query, vector, ['fear']), samples),
        'optimized': timed(lambda: index.search(query, vector, ['fear']), samples)}}
    if real:
        from serve import Engine
        started = time.perf_counter()
        engine = Engine()
        report['real'] = {'loadSeconds': round(time.perf_counter() - started, 2), 'indexDocuments': len(engine.docs), 'runs': []}
        text = 'I feel anxious about a new job and uncertain about the decision I made.'
        query_vector = engine.encoder.encode([text], normalize_embeddings=True, convert_to_numpy=True)[0]
        detected = ['fear']
        old = legacy_search(engine.index, text, query_vector, detected)
        new = [{'id': hit['id'], 'score': hit['score']} for hit in engine.index.search(text, query_vector, detected)]
        if old != new:
            raise AssertionError('Real index retrieval differs from baseline')
        report['real']['pairedSearch'] = {'matching_results': True,
            'legacy': timed(lambda: legacy_search(engine.index, text, query_vector, detected), samples),
            'optimized': timed(lambda: engine.index.search(text, query_vector, detected), samples)}
        memories = [{'id': str(uuid.UUID(int=i+1)), 'text': f'I decided to prepare for a new role and practice communication, step {i}.'} for i in range(300)]
        for count in (0, 20, 80, 300):
            engine.analyze(text, memories=memories[:count])
            results = []
            for _ in range(samples):
                started = time.perf_counter()
                result = engine.analyze(text, memories=memories[:count])
                results.append({'totalMs': round((time.perf_counter()-started)*1000, 2), **result['timings']})
            report['real']['runs'].append({'memories': count, 'medianMs': round(statistics.median(r['totalMs'] for r in results), 2),
                'p95Ms': round(float(np.percentile([r['totalMs'] for r in results], 95)), 2), 'results': results})
        report['real']['concurrency'] = []
        for count in (80, 300):
            with ThreadPoolExecutor(max_workers=4) as pool:
                started = time.perf_counter()
                results = list(pool.map(lambda _: engine.analyze(text, memories=memories[:count]), range(4)))
                elapsed = time.perf_counter() - started
            report['real']['concurrency'].append({'memories': count, 'requests': len(results), 'concurrency': 4,
                'elapsedMs': round(elapsed*1000, 2), 'requestsPerSecond': round(len(results)/elapsed, 3)})
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--samples', type=int, default=20)
    parser.add_argument('--real', action='store_true')
    args = parser.parse_args()
    if not 1 <= args.samples <= 1000:
        parser.error('--samples must be between 1 and 1000')
    print(json.dumps(benchmark(args.samples, args.real), indent=2))
