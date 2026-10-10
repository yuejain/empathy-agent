import json, tempfile, unittest, uuid, threading
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from corpus import write_json,digest,LABELS
import model_registry as registry
import serve,maintenance,train_classifier

class ModelTests(unittest.TestCase):
    def test_frozen_gate_uses_human_validation_not_test_and_rejects_invalid_scores(self):
        baseline={'validation/en/human':{'examples':100,'macro_f1':.5},'test/en/human':{'examples':100,'macro_f1':.7}}
        candidate={'validation/en/human':{'examples':100,'macro_f1':.49},'test/en/human':{'examples':100,'macro_f1':.1}}
        self.assertTrue(registry.quality_gate(candidate,baseline)['passed'])
        for value in [.47,float('nan'),float('inf'),None]:
            candidate['validation/en/human']['macro_f1']=value;self.assertFalse(registry.quality_gate(candidate,baseline)['passed'])
        self.assertFalse(registry.quality_gate({}, {})['passed'])
    def model(self,root,passed=True):
        version=uuid.uuid4().hex;path=registry.location(version,root);path.parent.mkdir(parents=True);path.write_bytes(b'fixture-local-model')
        write_json(path.parent/'manifest.json',{'version':version,'passed':passed,'head_sha256':digest(path.read_bytes())});return version
    def test_publication_and_rollback_preserve_previous_artifacts(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'emotion-head.joblib').write_bytes(b'original');version=self.model(root)
            registry.publish(version,root);self.assertEqual(registry.pointer(root),{'version':version,'previous':'legacy'})
            registry.rollback(root);self.assertEqual(registry.pointer(root)['version'],'legacy');self.assertTrue(registry.location(version,root).exists())
    def test_unpassed_or_corrupt_candidate_cannot_replace_active_head(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'emotion-head.joblib').write_bytes(b'original');version=self.model(root,False)
            with self.assertRaises(ValueError):registry.publish(version,root)
            good=self.model(root);registry.location(good,root).write_bytes(b'changed')
            with self.assertRaises(ValueError):registry.publish(good,root)
            self.assertEqual(registry.pointer(root)['version'],'legacy')
            with self.assertRaises(ValueError):registry.location('../escape',root)
    def test_failed_head_reload_leaves_loaded_model_unchanged(self):
        e=serve.Engine.__new__(serve.Engine);e.model_version='legacy';e.head={'original':True};e.encoder=SimpleNamespace(get_sentence_embedding_dimension=lambda:384);e.model_lock=threading.Lock()
        bad={'labels':LABELS,'heads':[SimpleNamespace(n_features_in_=3) for _ in LABELS]}
        with patch.object(registry,'pointer',return_value={'version':'a'*32}),patch.object(registry,'verified_model',return_value=Path('fixture')),patch.dict('sys.modules',{'joblib':SimpleNamespace(load=lambda _:bad)}):
            with self.assertRaises(ValueError):e.reload_model()
            self.assertEqual(e.model_version,'legacy');self.assertEqual(e.head,{'original':True})
    def test_retraining_uses_fixed_candidate_command_and_unpassed_gate_reports_partial(self):
        with tempfile.TemporaryDirectory() as directory,patch.object(maintenance,'DATA',Path(directory)),patch.object(registry,'status',return_value={'candidate':{'passed':False}}):
            calls=[];worker=maintenance.Maintenance(run=lambda args,**kw:calls.append(args),start_scheduler=False);worker.work('retrain')
            self.assertEqual(calls[0][-2:],['ml/train_classifier.py','--candidate']);self.assertEqual(worker.snapshot()['status'],'partial')
    def test_training_process_holds_lease_and_blocks_rollback_until_exit(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/'models/local';root.mkdir(parents=True);(root/'emotion-head.joblib').write_bytes(b'original')
            version=self.model(root);registry.publish(version,root)
            def train(args):
                self.assertTrue(args.candidate)
                with self.assertRaises(OSError):registry.rollback(root)
                self.assertEqual(registry.pointer(root)['version'],version)
            with patch.object(train_classifier,'ROOT',Path(directory)),patch.object(train_classifier,'train',side_effect=train):
                train_classifier.main(['--candidate'])
            registry.rollback(root);self.assertEqual(registry.pointer(root)['version'],'legacy')

if __name__=='__main__':unittest.main()
