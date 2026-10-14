"""Semantic and concurrency regressions for the optimized retrieval hot path."""
import threading
import unittest
from unittest.mock import patch

import numpy as np

from retrieval import PublicIndex, lexical
from serve import AnalysisBusy, Engine
import test_joint


def reference_search(documents, vectors, query, query_vector, detected):
    terms = lexical(query)
    cosine = vectors @ query_vector
    rankings = []
    for index, document in enumerate(documents):
        overlap = len(terms & lexical(document['text'])) / max(1, len(terms))
        affect = len(set(document['emotions']) & set(detected)) / max(1, len(detected))
        score = .75*float(cosine[index]) + .15*overlap + .1*affect
        if len(query) >= 8 and affect > 0 and cosine[index] >= .35 and score >= .38:
            rankings.append((score, index))
    rankings.sort(reverse=True)
    hits, groups = [], set()
    for score, index in rankings:
        document = documents[index]
        if document['group'] in groups:
            continue
        groups.add(document['group'])
        hits.append({key: document[key] for key in (
            'id', 'text', 'response', 'source', 'source_url', 'license', 'language', 'emotions', 'category'
        )} | {'score': round(score, 4)})
        if len(hits) == 3:
            break
    return hits


class RetrievalPerformanceTests(unittest.TestCase):
    def test_vectorized_ranking_matches_original_with_ties_and_groups(self):
        random = np.random.default_rng(42)
        labels = ['sadness', 'fear', 'joy']
        documents = [dict(id=str(i), text=('工作 焦虑 sad lonely ' if i % 2 else 'joyful uncertain ') + str(i),
            response='fixture', source='fixture', source_url='https://example.org', license='fixture',
            language='zh' if i % 2 else 'en', emotions=labels[:i % 4], category='fixture', group=str(i // 3)) for i in range(150)]
        vectors = random.normal(size=(150, 8)).astype(np.float32)
        vectors /= np.linalg.norm(vectors, axis=1, keepdims=True)
        vectors[0:5] = vectors[6]  # Deliberate score ties.
        snapshot = PublicIndex(documents, vectors)
        for _ in range(100):
            vector = random.normal(size=8).astype(np.float32)
            vector /= np.linalg.norm(vector)
            detected = labels[:int(random.integers(1, 4))]
            query = ['Hi', '工作让我有些焦虑', 'sad lonely uncertain work'][int(random.integers(3))]
            self.assertEqual(snapshot.search(query, vector, detected), reference_search(documents, vectors, query, vector, detected))

    def test_request_deduplication_preserves_private_record_ids_without_reusing_texts(self):
        engine = test_joint.JointTests().engine()
        encoder = engine.encoder
        with patch.object(encoder, 'encode', wraps=encoder.encode) as encode:
            result = engine.analyze('current joy', memories=[{'id': 'one', 'text': 'same private text'}, {'id': 'two', 'text': 'same private text'}])
            self.assertEqual(encode.call_args.args[0], ['current joy', 'same private text'])
            self.assertEqual([hit['id'] for hit in result['memory_hits']], ['one', 'two'])
            engine.analyze('current joy', memories=[{'id': 'one', 'text': 'same private text'}])
            self.assertEqual(encode.call_count, 2)
        self.assertNotIn('same private text', str(vars(engine)))

    def test_admission_rejects_backlog_and_releases_slots_after_failure(self):
        engine = test_joint.JointTests().engine()
        engine.analysis_slots = threading.BoundedSemaphore(1)
        engine.analysis_slots.acquire()
        with self.assertRaises(AnalysisBusy):
            engine.analyze('current joy')
        engine.analysis_slots.release()
        with patch.object(engine.encoder, 'encode', side_effect=RuntimeError('fixture')):
            with self.assertRaises(RuntimeError):
                engine.analyze('current joy')
        self.assertEqual(engine.analyze('current joy')['emotion'], 'joy')

    def test_refresh_is_single_flight_and_failed_versions_are_throttled(self):
        engine = test_joint.JointTests().engine()
        engine.index_version = 'original'
        engine.refresh_lock = threading.Lock()
        engine.next_refresh_at = 0.
        entered, release = threading.Event(), threading.Event()
        def reload():
            entered.set()
            self.assertTrue(release.wait(2))
            raise ValueError('invalid publication')
        with patch.object(engine, 'reload_index', side_effect=reload) as reload_index:
            thread = threading.Thread(target=engine.refresh)
            thread.start()
            self.assertTrue(entered.wait(2))
            for _ in range(10):
                engine.refresh()
            release.set()
            thread.join(2)
            self.assertFalse(thread.is_alive())
            engine.refresh()
            self.assertEqual(reload_index.call_count, 1)
            self.assertEqual(engine.index_version, 'original')


if __name__ == '__main__':
    unittest.main()
