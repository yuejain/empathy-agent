"""Offline, frozen synthetic bilingual regression. Never a human release-quality claim."""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import threading
import time

from quality_metrics import LABELS, classification_metrics, retrieval_metrics
from quality_schema import ROOT, load_fixture, strict_json, validate_report


def fingerprint(folder):
    # Identify the actual local encoder configuration and weights, not its display name.
    files = sorted(path for path in folder.rglob('*') if path.is_file() and path.suffix in ('.json','.txt','.safetensors','.bin'))
    if not files:
        raise ValueError('Missing local encoder files')
    result = hashlib.sha256()
    for path in files:
        result.update(path.relative_to(folder).as_posix().encode())
        digest = hashlib.sha256()
        with path.open('rb') as handle:
            for block in iter(lambda:handle.read(1<<20),b''):
                digest.update(block)
        result.update(digest.digest())
    return result.hexdigest()


def save(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    temp = path.with_suffix(path.suffix+'.tmp')
    temp.write_text(json.dumps(value,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8')
    temp.replace(path)


def local_engine(fixture):
    os.environ['HF_HUB_OFFLINE']='1'
    os.environ['TRANSFORMERS_OFFLINE']='1'
    os.environ['TOKENIZERS_PARALLELISM']='false'
    import numpy as np
    import torch
    import joblib
    from sentence_transformers import SentenceTransformer
    from model_registry import pointer,verified_model
    from retrieval import PublicIndex
    from serve import Engine
    torch.set_num_threads(6)
    version = pointer()['version']
    head_path = verified_model(version)
    folder = ROOT/'models/local/encoder'
    encoder = SentenceTransformer(str(folder),device='cpu',local_files_only=True)
    head = joblib.load(head_path)
    if head['labels'] != LABELS or len(head['heads']) != len(LABELS):
        raise ValueError('Incompatible local classifier')
    # Use the production analyze implementation with a controlled public snapshot. This
    # avoids inventing relevance judgments for unreviewed live corpus documents.
    engine = Engine.__new__(Engine)
    engine.encoder,engine.head = encoder,head
    engine.encoder_lock = threading.Lock()
    vectors = encoder.encode([d['text'] for d in fixture['documents']],normalize_embeddings=True,convert_to_numpy=True)
    engine.index = PublicIndex(fixture['documents'],np.asarray(vectors))
    metadata = {'head_sha256':hashlib.sha256(head_path.read_bytes()).hexdigest(),
        'encoder_fingerprint_sha256':fingerprint(folder),'version':version,'device':'cpu','network':'offline'}
    return engine,metadata


def evaluate(engine,metadata,fixture,fixture_hash):
    import numpy as np
    started=time.perf_counter()
    rows=fixture['classification']
    vectors=engine.encoder.encode([r['text'] for r in rows],batch_size=32,normalize_embeddings=True,convert_to_numpy=True)
    probabilities=np.stack([h.predict_proba(vectors)[:,1] for h in engine.head['heads']],axis=1).tolist()
    targets=[[int(label in row['labels']) for label in LABELS] for row in rows]
    classification={}
    for language in ('zh','en','all'):
        indices=[i for i,r in enumerate(rows) if language=='all' or r['language']==language]
        classification[language]=classification_metrics([targets[i] for i in indices],[probabilities[i] for i in indices])
    cases,normal,oracle=[],[],[]
    documents={d['id']:d for d in fixture['documents']}
    for query in fixture['retrieval']:
        result=engine.analyze(query['text'])
        vector=engine.encoder.encode([query['text']],normalize_embeddings=True,convert_to_numpy=True)[0]
        oracle_hits=engine.index.search(query['text'],vector,query['emotions'])
        for hits,collection in ((result['hits'],normal),(oracle_hits,oracle)):
            collection.append({'language':query['language'],'relevant_ids':query['relevant_groups'],
                'forbidden_ids':list({documents[x]['group'] for x in query['forbidden_ids']}),
                'retrieved_ids':[documents[x['id']]['group'] for x in hits]})
        cases.append({'id':query['id'],'language':query['language'],'relevant_groups':query['relevant_groups'],
            'retrieved_document_ids':[h['id'] for h in result['hits']], 'oracle_document_ids':[h['id'] for h in oracle_hits]})
    summarize=lambda data:{language:retrieval_metrics([c for c in data if language=='all' or c['language']==language],3) for language in ('zh','en','all')}
    report={'schema_version':1,'status':'regression_only','fixture_id':fixture['fixture_id'],'fixture_sha256':fixture_hash,
        'created_at':datetime.now(timezone.utc).isoformat(),'provenance':'synthetic-agent-authored','human_validation':False,
        'model':metadata,'method':{'threshold':.5,'ece_bins':10,'calibration':'all sample-label pairs, fixed equal-width bins',
            'retrieval_corpus':'synthetic fixture documents; not the deployed public index'},
        'classification':classification,'public_retrieval':summarize(normal),'public_retrieval_oracle_emotion':summarize(oracle),
        'classification_cases':[{'id':r['id'],'language':r['language'],'expected':r['labels'],
            'predicted':[label for label,p in zip(LABELS,probabilities[i]) if p>=.5],
            'probabilities':dict(zip(LABELS,probabilities[i]))} for i,r in enumerate(rows)],
        'public_retrieval_cases':cases,'elapsed_seconds':round(time.perf_counter()-started,3),
        'limitations':['Synthetic agent-authored labels are not independently human validated.',
            'These small balanced examples do not estimate real-world Chinese or English reliability.',
            'Public retrieval measures a controlled synthetic index, not the deployed 4000-document corpus.',
            'No training, threshold tuning, cloud requests, private store reads or downloaded corpora were used.',
            'Brier and ECE use all binary sample-label pairs; pooled scores can hide per-label calibration errors.',
            'Classification uses the fixed 0.5 multi-label threshold; retrieval uses production top-one fallback when no label passes.']}
    return validate_report(report)


def memory_evaluation(engine,output):
    adapter=ROOT/'evals/evaluate-memory.cjs'
    prepared=subprocess.run(['node',str(adapter),'--prepare'],cwd=ROOT,capture_output=True,check=True,encoding='utf-8')
    cases=strict_json(prepared.stdout)
    if isinstance(cases,dict):
        cases=cases['cases']
    results=[]
    for case in cases:
        request=case['request']
        response=engine.analyze(request['text'],request['query'],request['memories'])
        results.append({'id':case['id'],'memory_hits':response['memory_hits']})
    # Only this frozen synthetic adapter is accepted; retaining its scores permits
    # report-validator changes to be checked without rerunning the encoder.
    save(output.with_name('memory-score-input.json'),results)
    scored=subprocess.run(['node',str(adapter),'--score'],cwd=ROOT,input=json.dumps(results,ensure_ascii=False,allow_nan=False),
        capture_output=True,check=True,encoding='utf-8')
    result=strict_json(scored.stdout)
    # The adapter validates IDs, fixture fingerprint, scores, and complete language coverage.
    save(output,result)
    return result


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--output',type=Path,default=ROOT/'artifacts/evaluation/bilingual-quality.json')
    parser.add_argument('--memory',action='store_true',help='Also run production Node memory retrieval with the same local encoder')
    parser.add_argument('--validate-report',type=Path)
    args=parser.parse_args()
    if args.validate_report:
        validate_report(strict_json(args.validate_report.read_text(encoding='utf-8')))
        print(json.dumps({'valid':True}));return
    fixture,fixture_hash=load_fixture() # Validate and freeze before loading models.
    engine,metadata=local_engine(fixture)
    report=evaluate(engine,metadata,fixture,fixture_hash)
    save(args.output,report)
    if args.memory:
        memory_evaluation(engine,args.output.with_name('memory-retrieval.json'))
    print(json.dumps({key:report[key] for key in ('status','classification','public_retrieval','public_retrieval_oracle_emotion')},ensure_ascii=False,allow_nan=False))


if __name__=='__main__':
    main()
