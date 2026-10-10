"""Frozen multilingual encoder + trainable 8-label linear head, and an emotion-aware index."""
from __future__ import annotations
import argparse, collections, json, os, random, time, uuid
from datetime import datetime, timezone
from pathlib import Path
from corpus import ROOT, DATA, LABELS, read_jsonl, write_json, digest

os.environ.setdefault('HF_HOME',str(DATA/'cache/huggingface'))
os.environ.setdefault('HF_HUB_DISABLE_XET','1')

def metrics(y, predicted):
    from sklearn.metrics import f1_score, precision_score, recall_score
    return {'examples':len(y),'macro_f1':float(f1_score(y,predicted,average='macro',zero_division=0)),
        'micro_f1':float(f1_score(y,predicted,average='micro',zero_division=0)),
        'micro_precision':float(precision_score(y,predicted,average='micro',zero_division=0)),
        'micro_recall':float(recall_score(y,predicted,average='micro',zero_division=0))}

def main(argv=None):
    parser=argparse.ArgumentParser(); parser.add_argument('--max-per-language',type=int,default=10000); parser.add_argument('--candidate',action='store_true'); args=parser.parse_args(argv)
    from model_registry import classifier_lease
    # Held by the training process itself, even if its launching service exits.
    with classifier_lease(ROOT/'models/local'):train(args)

def train(args):
    import numpy as np, torch, joblib
    from sentence_transformers import SentenceTransformer
    from sklearn.linear_model import LogisticRegression
    started=time.time(); random.seed(42); np.random.seed(42); torch.manual_seed(42)
    torch.set_num_threads(8)
    out=ROOT/'models/local'; out.mkdir(parents=True,exist_ok=True)
    encoder_name='sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2'
    base=ROOT/'models/local/encoder-base'
    revision=json.loads((base/'download-manifest.json').read_text())['revision']
    encoder=SentenceTransformer(str(out/'encoder' if args.candidate else base),device='cpu' if args.candidate else 'cuda' if torch.cuda.is_available() else 'cpu',local_files_only=True)
    old_head=None
    if args.candidate:
        from model_registry import pointer,verified_model
        old_head=joblib.load(verified_model(pointer()['version']))
    rows=list(read_jsonl(DATA/'processed/corpus.jsonl'))
    labeled=[r for r in rows if r['emotions']]
    training=[]
    for language in ['zh','en']:
        candidates=[r for r in labeled if r['split']=='train' and r['language']==language]
        random.shuffle(candidates); training+=candidates[:args.max_per_language]
    evaluation=[r for r in labeled if r['split'] in ('validation','test')]
    if not training or not evaluation: raise ValueError('Training and held-out records are required')
    all_rows=training+evaluation
    x=encoder.encode([r['text'] for r in all_rows],batch_size=96,normalize_embeddings=True,show_progress_bar=True,convert_to_numpy=True)
    y=np.array([[int(label in r['emotions']) for label in LABELS] for r in all_rows])
    n=len(training); counts=collections.Counter(r['language'] for r in training)
    sample_weight=np.array([min(10,n/(len(counts)*counts[r['language']]))*(1 if r['label_origin']=='human' else .25) for r in training])
    # Fixed C and threshold: test is never used to select hyperparameters.
    heads=[]
    for col in range(len(LABELS)):
        head=LogisticRegression(C=2.0,class_weight='balanced',max_iter=500,random_state=42)
        head.fit(x[:n],y[:n,col],sample_weight=sample_weight); heads.append(head)
    version=uuid.uuid4().hex if args.candidate else None
    target=out/'classifiers'/version if args.candidate else out;target.mkdir(parents=True,exist_ok=True)
    joblib.dump({'heads':heads,'labels':LABELS,'threshold':.5},target/'emotion-head.joblib')
    if not args.candidate:encoder.save(str(out/'encoder'))
    report={'seed':42,'encoder':encoder_name,'revision':revision,'encoder_frozen':True,
      'trained_parameters':int(sum(h.coef_.size+h.intercept_.size for h in heads)),
      'backend':str(encoder.device),'encoder_backend':str(encoder.device),'head_training_backend':'cpu (scikit-learn)',
      'gpu':torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
      'training_languages':dict(counts),'training_label_origins':dict(collections.Counter(r['label_origin'] for r in training)),
      'weighting':'inverse language frequency capped at 10; weak labels weighted 0.25',
      'training_content_hashes_sha256':digest('\n'.join(sorted(r['content_hash'] for r in training))),
      'evaluations':{},'threshold':.5,'corpus_sha256':digest((DATA/'processed/corpus.jsonl').read_bytes())}
    baseline={}
    for split in ['validation','test']:
      for language in ['zh','en']:
       for origin in ['human','weak-keywords']:
        indexes=[n+i for i,r in enumerate(evaluation) if r['split']==split and r['language']==language and r['label_origin']==origin]
        if not indexes: continue
        probabilities=np.stack([h.predict_proba(x[indexes])[:,1] for h in heads],axis=1)
        report['evaluations'][f'{split}/{language}/{origin}']=metrics(y[indexes],probabilities>=.5)
        if old_head:
            probabilities=np.stack([h.predict_proba(x[indexes])[:,1] for h in old_head['heads']],axis=1)
            baseline[f'{split}/{language}/{origin}']=metrics(y[indexes],probabilities>=.5)
    if args.candidate:
        from model_registry import quality_gate,atomic_json,publish
        gate=quality_gate(report['evaluations'],baseline)
        manifest={**report,**gate,'baseline':baseline,'version':version,'createdAt':datetime.now(timezone.utc).isoformat(),
            'head_sha256':digest((target/'emotion-head.joblib').read_bytes()),'elapsed_seconds':round(time.time()-started,2)}
        write_json(target/'manifest.json',manifest);atomic_json(out/'classifiers/latest.json',manifest)
        if gate['passed']:publish(version)
        print(json.dumps({'version':version,**gate,'elapsed_seconds':manifest['elapsed_seconds']},ensure_ascii=False),flush=True)
        return
    from build_index import build
    index=build(encoder,rows)
    report.update(index_documents=index['documents'],index_languages=index['languages'],elapsed_seconds=round(time.time()-started,2))
    write_json(DATA/'reports/classifier.json',report)
    print(json.dumps(report,ensure_ascii=False,indent=2),flush=True)

if __name__=='__main__': main()
