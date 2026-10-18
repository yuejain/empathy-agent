import copy
import json
import math
import tempfile
import unittest
from pathlib import Path

from quality_metrics import LABELS, classification_metrics, retrieval_metrics
from quality_schema import ROOT, load_fixture, schema, strict_json, validate, validate_report
from model_registry import quality_gate


class QualityTests(unittest.TestCase):
    def test_frozen_fixture_has_bilingual_label_coverage_and_explicit_synthetic_origin(self):
        fixture,_=load_fixture()
        self.assertFalse(fixture['provenance']['human_reviewed'])
        for language in ('zh','en'):
            rows=[r for r in fixture['classification'] if r['language']==language]
            self.assertEqual(len(rows),26)
            self.assertEqual({label for r in rows for label in r['labels']},set(LABELS))
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'modified.json'
            path.write_text(json.dumps(fixture),encoding='utf-8')
            with self.assertRaisesRegex(ValueError,'hash mismatch'):load_fixture(path)

    def test_classification_metrics_are_multilabel_and_calibration_is_not_accuracy(self):
        y=[[1,0,0,0,0,0,0,0],[0,1,0,0,0,0,0,0]]
        perfect=classification_metrics(y,[[float(v) for v in row] for row in y])
        self.assertEqual(perfect['micro_f1'],1)
        self.assertEqual(perfect['macro_f1'],.25) # All eight fixed labels, including absent labels.
        self.assertEqual(perfect['brier'],0)
        self.assertEqual(perfect['ece'],0)
        uncertain=classification_metrics(y,[[.5]*8]*2)
        self.assertEqual(uncertain['brier'],.25)
        self.assertEqual(uncertain['ece'],.375)
        for bad in (float('nan'),float('inf'),True,-.1,1.1):
            with self.assertRaises(ValueError):classification_metrics(y,[[bad]*8]*2)

    def test_ranking_metrics_count_no_answer_and_forbidden_hits_separately(self):
        result=retrieval_metrics([
            {'relevant_ids':['a','b'],'retrieved_ids':['x','a'],'forbidden_ids':[]},
            {'relevant_ids':[],'retrieved_ids':['deleted'],'forbidden_ids':['deleted']}],3)
        self.assertEqual(result['recall_at_k'],.5)
        self.assertEqual(result['mrr'],.5)
        self.assertEqual(result['false_hits'],2)
        self.assertEqual(result['forbidden_hits'],1)
        self.assertEqual(result['no_answer_false_positive_rate'],1)
        with self.assertRaises(ValueError):retrieval_metrics([{'relevant_ids':['a'],'retrieved_ids':['a','a']}],3)

    def test_strict_schema_rejects_unknown_fields_bad_origin_and_json_duplicates(self):
        fixture,_=load_fixture()
        for field,value in [('human_reviewed',True),('kind','human')]:
            modified=copy.deepcopy(fixture);modified['provenance'][field]=value
            with self.assertRaises(ValueError):validate(modified,schema('fixture.schema.json'))
        fixture['unexpected']=True
        with self.assertRaises(ValueError):validate(fixture,schema('fixture.schema.json'))
        for text in ('{"x":1,"x":2}','{"x":NaN}','{"x":Infinity}'):
            with self.assertRaises(ValueError):strict_json(text)

    def test_gate_needs_both_human_languages_and_bound_sample_identity(self):
        from test_models import valid_evaluations
        baseline=valid_evaluations()
        for change in ('missing_zh','synthetic','small','unsupported_label','bad_ece','bad_baseline','mismatched_sample','fake_pass'):
            candidate=valid_evaluations();reference=copy.deepcopy(baseline)
            score=candidate['validation/zh/human']
            if change=='missing_zh':del candidate['validation/zh/human']
            if change=='synthetic':score['label_origin']='synthetic-agent-authored'
            if change=='small':score['examples']=99
            if change=='unsupported_label':score['label_support']['fear']=0
            if change=='bad_ece':score['ece']=.11
            if change=='bad_baseline':reference['validation/en/human']['macro_f1']=float('nan')
            if change=='mismatched_sample':score['sample_sha256']='a'*64
            if change=='fake_pass':candidate={'passed':True,'human_reviewed':True}
            self.assertFalse(quality_gate(candidate,reference)['passed'],change)
        for bad in (None,[],True):self.assertFalse(quality_gate(bad,baseline)['passed'])

    def test_report_schema_fails_closed_before_optional_model_dependencies(self):
        for value in ({}, {'status':'passed','human_validation':True}, None):
            with self.assertRaises(ValueError):validate_report(value)

    def test_report_recomputes_metrics_and_requires_every_frozen_case(self):
        import numpy as np
        from types import SimpleNamespace
        from evaluate_quality import evaluate
        fixture,sha=load_fixture()
        head=SimpleNamespace(predict_proba=lambda vectors:np.full((len(vectors),2),.5))
        engine=SimpleNamespace(encoder=SimpleNamespace(encode=lambda texts,**kw:np.zeros((len(texts),8))),
            head={'heads':[head]*8},analyze=lambda text:{'hits':[]},index=SimpleNamespace(search=lambda *args:[]))
        metadata={'head_sha256':'a'*64,'encoder_fingerprint_sha256':'b'*64,'version':'test','device':'cpu','network':'offline'}
        report=evaluate(engine,metadata,fixture,sha)
        validate_report(report)
        for change in ('missing_language','missing_case','duplicate_case','fake_score','fake_count','nan','human','foreign_document'):
            changed=copy.deepcopy(report)
            if change=='missing_language':del changed['classification']['zh']
            if change=='missing_case':changed['classification_cases'].pop()
            if change=='duplicate_case':changed['classification_cases'][-1]=changed['classification_cases'][0]
            if change=='fake_score':changed['classification']['all']['macro_f1']=.999
            if change=='fake_count':changed['public_retrieval']['all']['queries']=1000
            if change=='nan':changed['classification_cases'][0]['probabilities']['joy']=float('nan')
            if change=='human':changed['human_validation']=True
            if change=='foreign_document':changed['public_retrieval_cases'][0]['retrieved_document_ids']=['not-in-fixture']
            with self.assertRaises(ValueError,msg=change):validate_report(changed)


if __name__=='__main__':unittest.main()
