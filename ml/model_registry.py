"""Versioned, locally-produced classifier heads. Never accept uploaded pickle files."""
import json, re
from pathlib import Path
from corpus import ROOT, digest, write_json
from lease import corpus_lease
from quality_metrics import LABELS, probability

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
    if version=='legacy':raise ValueError('Legacy bootstrap cannot be published as a new candidate; use rollback for an existing previous version')
    path=verified_model(version,root)
    if version!='legacy':
        manifest=json.loads((path.parent/'manifest.json').read_text(encoding='utf-8'))
        gate=quality_gate(manifest.get('evaluations'),manifest.get('baseline'))
        if manifest.get('gate_version')!=2 or not gate['passed']:
            raise ValueError('Candidate lacks verified bilingual validation coverage')
    old=pointer(root)
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
            'candidate':{k:candidate.get(k) for k in ['version','passed','reasons','evaluations','baseline','scope','createdAt','gate_version','quality_status']} if isinstance(candidate,dict) else None}
    except (OSError,ValueError,KeyError):return {'activeVersion':'unavailable','canRollback':False,'candidate':None}
def quality_gate(evaluations,baseline):
    """Frozen engineering release policy, not evidence of statistical sufficiency.

    Validation selects; test and synthetic regression examples never qualify.
    Existing active artifacts may keep serving while new candidates remain blocked.
    """
    keys=['validation/zh/human','validation/en/human']
    reasons=[]
    if not isinstance(evaluations,dict) or not isinstance(baseline,dict):
        return {'passed':False,'reasons':['无效候选或基线报告'],'scope':keys,'gate_version':2,'quality_status':'insufficient_or_failed'}
    for key in keys:
        candidate,reference=evaluations.get(key),baseline.get(key)
        valid=True
        for name,score in [('候选',candidate),('基线',reference)]:
            if not isinstance(score,dict) or type(score.get('examples')) is not int or score['examples']<100:
                reasons.append(key+': '+name+'缺少至少 100 条人工验证样本');valid=False;continue
            if any(not probability(score.get(metric)) for metric in ('macro_f1','micro_f1','micro_precision','micro_recall','ece','brier')):
                reasons.append(key+': '+name+'指标无效');valid=False
            supports=score.get('label_support')
            if not isinstance(supports,dict) or set(supports)!=set(LABELS) or any(type(v) is not int or not 5<=v<=score['examples'] for v in supports.values()):
                reasons.append(key+': '+name+'八类覆盖不足');valid=False
            if score.get('calibration_bins')!=10 or score.get('label_origin')!='human' or score.get('split')!='validation' or score.get('language')!=key.split('/')[1] or not isinstance(score.get('sample_sha256'),str) or not re.fullmatch(r'[0-9a-f]{64}',score['sample_sha256']):
                reasons.append(key+': '+name+'验证来源或校准方法缺失');valid=False
        if not valid:continue
        if candidate['examples']!=reference['examples'] or candidate['sample_sha256']!=reference['sample_sha256'] or candidate['label_support']!=reference['label_support']:
            reasons.append(key+': 验证样本不一致');continue
        if candidate['macro_f1']<.40:reasons.append(key+': macro F1 低于 0.40')
        if candidate['ece']>.15 or candidate['brier']>.20:reasons.append(key+': 校准误差超过冻结门槛')
        if candidate['macro_f1']+1e-12<reference['macro_f1']:reasons.append(key+': macro F1 下降')
        if candidate['ece']>reference['ece']+1e-12 or candidate['brier']>reference['brier']+1e-12:reasons.append(key+': 校准误差增大')
    return {'passed':not reasons,'reasons':reasons,'scope':keys,'gate_version':2,'quality_status':'bilingual_validation_passed' if not reasons else 'insufficient_or_failed'}
