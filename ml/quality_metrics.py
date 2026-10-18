"""Dependency-light multilabel and ranked-retrieval metrics with finite-input checks."""
from __future__ import annotations
import math

LABELS = ['joy', 'sadness', 'anger', 'fear', 'love', 'surprise', 'confusion', 'neutral']


def probability(value):
    return type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 1


def classification_metrics(targets, probabilities, bins=10):
    if not targets or len(targets) != len(probabilities) or type(bins) is not int or bins < 1:
        raise ValueError('Invalid classification sample count')
    width = len(LABELS)
    if any(len(y) != width or any(type(v) is not int or v not in (0, 1) for v in y) for y in targets):
        raise ValueError('Invalid multilabel targets')
    if any(len(p) != width or any(not probability(v) for v in p) for p in probabilities):
        raise ValueError('Invalid probabilities')
    tp, fp, fn, supports = [0]*width, [0]*width, [0]*width, [0]*width
    buckets = [[] for _ in range(bins)]
    squared = 0.
    for expected, scores in zip(targets, probabilities):
        for i, (truth, score) in enumerate(zip(expected, scores)):
            predicted = score >= .5
            supports[i] += truth
            tp[i] += int(predicted and truth == 1)
            fp[i] += int(predicted and truth == 0)
            fn[i] += int(not predicted and truth == 1)
            squared += (truth-score)**2
            buckets[min(bins-1, int(score*bins))].append((truth, score))
    f1 = lambda a,b,c: 2*a/(2*a+b+c) if 2*a+b+c else 0.
    size = len(targets)*width
    ece = sum(abs(sum(y-p for y,p in bucket))/size for bucket in buckets)
    return {'examples':len(targets), 'macro_f1':sum(f1(*v) for v in zip(tp,fp,fn))/width,
        'micro_f1':f1(sum(tp),sum(fp),sum(fn)),
        'micro_precision':sum(tp)/(sum(tp)+sum(fp)) if sum(tp)+sum(fp) else 0.,
        'micro_recall':sum(tp)/(sum(tp)+sum(fn)) if sum(tp)+sum(fn) else 0.,
        'brier':squared/size, 'ece':ece, 'calibration_bins':bins,
        'label_support':dict(zip(LABELS, supports))}


def retrieval_metrics(cases, k):
    if not cases or type(k) is not int or k < 1:
        raise ValueError('Invalid retrieval sample count')
    recalls, reciprocals, false_hits, forbidden_hits, returned, no_answer_false = [], [], 0, 0, 0, 0
    no_answer = 0
    for case in cases:
        relevant, forbidden, retrieved = set(case['relevant_ids']), set(case.get('forbidden_ids', [])), case['retrieved_ids'][:k]
        if len(retrieved) != len(set(retrieved)) or relevant & forbidden:
            raise ValueError('Invalid relevance judgments')
        matches = relevant.intersection(retrieved)
        if relevant:
            recalls.append(len(matches)/len(relevant))
            reciprocals.append(next((1/(i+1) for i,value in enumerate(retrieved) if value in relevant), 0.))
        else:
            no_answer += 1
            no_answer_false += int(bool(retrieved))
        false_hits += sum(value not in relevant for value in retrieved)
        forbidden_hits += sum(value in forbidden for value in retrieved)
        returned += len(retrieved)
    return {'queries':len(cases), 'answerable_queries':len(recalls), 'no_answer_queries':no_answer,
        'k':k, 'recall_at_k':sum(recalls)/len(recalls) if recalls else 0.,
        'mrr':sum(reciprocals)/len(reciprocals) if reciprocals else 0.,
        'returned_hits':returned, 'false_hits':false_hits, 'forbidden_hits':forbidden_hits,
        'false_hit_rate':false_hits/returned if returned else 0.,
        'forbidden_hit_rate':forbidden_hits/returned if returned else 0.,
        'no_answer_false_positive_rate':no_answer_false/no_answer if no_answer else 0.}
