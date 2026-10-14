"""Immutable public retrieval snapshot; private request texts never enter this index."""
from __future__ import annotations

import heapq
import re
import numpy as np


def lexical(text):
    words = re.findall(r'[a-z]{2,}|[\u3400-\u9fff]', text.lower())
    return set(words + [a+b for a,b in zip(words,words[1:]) if len(a)==len(b)==1])


class PublicIndex:
    def __init__(self, documents, vectors):
        self.documents = documents
        self.vectors = vectors
        self.tokens = [lexical(document['text']) for document in documents]
        words, emotions = {}, {}
        for index, (document, tokens) in enumerate(zip(documents, self.tokens)):
            for term in tokens:
                words.setdefault(term, []).append(index)
            for emotion in set(document['emotions']):
                emotions.setdefault(emotion, []).append(index)
        self.words = {key: np.asarray(value, dtype=np.intp) for key, value in words.items()}
        self.emotions = {key: np.asarray(value, dtype=np.intp) for key, value in emotions.items()}

    def search(self, query, query_vector, detected):
        if len(query) < 8:
            return []
        count = len(self.documents)
        terms = lexical(query)
        overlap = np.zeros(count, dtype=np.float64)
        affect = np.zeros(count, dtype=np.float64)
        for term in terms:
            indices = self.words.get(term)
            if indices is not None:
                overlap[indices] += 1
        for emotion in set(detected):
            indices = self.emotions.get(emotion)
            if indices is not None:
                affect[indices] += 1
        overlap /= max(1, len(terms))
        affect /= max(1, len(detected))
        cosine = self.vectors @ query_vector
        # Promote to float64 before scoring, matching the original Python float arithmetic.
        scores = .75*cosine.astype(np.float64) + .15*overlap + .1*affect
        candidates = np.flatnonzero((affect > 0) & (cosine >= .35) & (scores >= .38))
        # Only the best document from each group can appear. Preserve the old score/index tie order.
        groups = {}
        for index in candidates:
            candidate = (float(scores[index]), int(index))
            group = self.documents[index]['group']
            if group not in groups or candidate > groups[group]:
                groups[group] = candidate
        hits = []
        for score, index in heapq.nlargest(3, groups.values()):
            document = self.documents[index]
            hits.append({key: document[key] for key in (
                'id', 'text', 'response', 'source', 'source_url', 'license', 'language', 'emotions', 'category'
            )} | {'score': round(score, 4)})
        return hits
