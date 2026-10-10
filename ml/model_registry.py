"""Versioned, locally-produced classifier heads. Never accept uploaded pickle files."""
import json, re, math
from pathlib import Path
from corpus import ROOT, digest, write_json
from lease import corpus_lease

MODEL_ROOT=ROOT/'models/local'

def classifier_lease(root=MODEL_ROOT):
    return corpus_lease(root/'classifiers/train.lock')
def atomic_json(path,value):
    write_json(path.with_suffix('.tmp'),value);path.with_suffix('.tmp').replace(path)
def location(version,root=MODEL_ROOT):
    if version=='legacy':return root/'emotion-head.joblib'
    if not isinstance(version,str) or not re.fullmatch(r'[0-9a-f]{32}',version):raise ValueError('Invalid classifier version')
    return root/'classifiers'/version/'emotion-head.joblib'
def pointer(root=MODEL_ROOT):
    path=root/'classifiers/active.json'
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else {'version':'legacy','previous':None}
def verified_model(version,root=MODEL_ROOT):
    path=location(version,root)
    if version!='legacy':
        manifest=json.loads((path.parent/'manifest.json').read_text(encoding='utf-8'))
        if manifest.get('version')!=version or manifest.get('passed') is not True or digest(path.read_bytes())!=manifest.get('head_sha256'):raise ValueError('Unverified classifier')
    elif not path.is_file():raise ValueError('No legacy classifier')
    return path
def publish(version,root=MODEL_ROOT):
    verified_model(version,root);old=pointer(root)
    if old['version']==version:return
    atomic_json(root/'classifiers/active.json',{'version':version,'previous':old['version']})
def rollback(root=MODEL_ROOT):
    with classifier_lease(root):
        old=pointer(root);previous=old.get('previous')
        if not previous:raise ValueError('No previous classifier')
        verified_model(previous,root)
        atomic_json(root/'classifiers/active.json',{'version':previous,'previous':old['version']})
def status(root=MODEL_ROOT):
    try:
        active=pointer(root);verified_model(active['version'],root)
        latest=root/'classifiers/latest.json';candidate=json.loads(latest.read_text(encoding='utf-8')) if latest.exists() else None
        # Report metrics and reasons only; never disclose local paths or model bytes.
        return {'activeVersion':active['version'],'canRollback':bool(active.get('previous')),
            'candidate':{k:candidate.get(k) for k in ['version','passed','reasons','evaluations','baseline','scope','createdAt']} if isinstance(candidate,dict) else None}
    except (OSError,ValueError,KeyError):return {'activeVersion':'unavailable','canRollback':False,'candidate':None}
def quality_gate(evaluations,baseline):
    """Freeze acceptance before training. Validation selects; test is reporting-only."""
    keys=sorted(k for k,v in baseline.items() if k.startswith('validation/') and k.endswith('/human') and v['examples']>=20)
    reasons=[]
    if not keys:reasons.append('缺少至少 20 条人工标签的验证分区')
    for key in keys:
        score=evaluations.get(key,{})
        if score.get('examples')!=baseline[key]['examples']:reasons.append(key+': 验证样本不一致');continue
        if not isinstance(score.get('macro_f1'),(float,int)) or not math.isfinite(score['macro_f1']) or not 0<=score['macro_f1']<=1:reasons.append(key+': 无效指标');continue
        if score.get('macro_f1',0)<.30:reasons.append(key+': macro F1 低于 0.30')
        if score.get('macro_f1',0)<baseline[key]['macro_f1']-.02:reasons.append(key+': macro F1 下降超过 0.02')
    return {'passed':not reasons,'reasons':reasons,'scope':keys}
