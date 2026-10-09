import json, tempfile, threading, unittest, uuid
from pathlib import Path
from unittest.mock import patch
import numpy as np
import serve, maintenance
from lease import corpus_lease
from corpus import digest,write_json

class Encoder:
    def encode(self,texts,**kwargs):return np.array([[1.,0.] if text=='current joy' else [0.,1.] for text in texts])
class Head:
    def predict_proba(self,v):return np.array([[1-v[0,0],v[0,0]]])

class JointTests(unittest.TestCase):
    def engine(self):
        e=serve.Engine.__new__(serve.Engine);e.encoder=Encoder();e.encoder_lock=threading.Lock()
        e.head={'heads':[Head()],'labels':['joy']};e.docs=[dict(id='public',text='public example',response='response',source='fixture',source_url='https://example.org',license='test',language='en',emotions=['joy'],category='dialogue',group='one')]
        e.vectors=np.array([[0.,1.]]);e.tokens=[serve.lexical(e.docs[0]['text'])];return e
    def test_query_expansion_does_not_change_current_emotion_and_private_records_never_join_public_index(self):
        e=self.engine();id=str(uuid.uuid4());before=json.dumps(e.docs)
        result=e.analyze('current joy','previous sad context',[{'id':id,'text':'private translated match'}])
        self.assertEqual(result['emotion'],'joy');self.assertEqual(result['confidence'],1)
        self.assertEqual(result['memory_hits'],[{'id':id,'score':1.}]);self.assertEqual(json.dumps(e.docs),before)
        self.assertNotIn('private translated match',json.dumps(result));self.assertGreaterEqual(result['timings']['encodeMs'],0)
    def test_private_embeddings_are_not_reused_on_next_request(self):
        e=self.engine();e.analyze('current joy',memories=[{'id':str(uuid.uuid4()),'text':'secret fixture'}])
        self.assertEqual(e.analyze('current joy')['memory_hits'],[])
    def test_atomic_index_reload_keeps_old_snapshot_if_new_snapshot_is_corrupt(self):
        with tempfile.TemporaryDirectory() as directory,patch.object(serve,'DATA',Path(directory)):
            e=self.engine();e.index_version=None;e.index_lock=threading.Lock()
            root=Path(directory)/'index'
            def publish(version,corrupt=False):
                folder=root/'versions'/version;folder.mkdir(parents=True)
                write_json(folder/'documents.json',e.docs);np.save(folder/'vectors.npy',e.vectors,allow_pickle=False)
                write_json(folder/'manifest.json',{'documents':1,'dimensions':2,'documents_sha256':digest((folder/'documents.json').read_bytes()),'vectors_sha256':'bad' if corrupt else digest((folder/'vectors.npy').read_bytes())})
                write_json(root/'current.json',{'version':version})
            first=uuid.uuid4().hex;publish(first);e.reload_index();self.assertEqual(e.index_version,first)
            publish(uuid.uuid4().hex,True);result=e.analyze('current joy');self.assertEqual(e.index_version,first);self.assertEqual(result['index_size'],1)

class MaintenanceTests(unittest.TestCase):
    def test_schedule_is_opt_in_and_persisted_without_chat_data(self):
        with tempfile.TemporaryDirectory() as directory,patch.object(maintenance,'DATA',Path(directory)):
            worker=maintenance.Maintenance(start_scheduler=False);self.assertEqual(worker.snapshot()['scheduleHours'],0)
            worker.configure(24);self.assertEqual(maintenance.Maintenance(start_scheduler=False).snapshot()['scheduleHours'],24)
            with self.assertRaises(ValueError):worker.configure(True)
            with self.assertRaises(ValueError):worker.configure(1)
            with self.assertRaises(ValueError):worker.start('arbitrary shell')
    def test_rebuild_uses_fixed_command_and_reports_failure_without_switching_index(self):
        with tempfile.TemporaryDirectory() as directory,patch.object(maintenance,'DATA',Path(directory)):
            calls=[]
            def fail(args,**kwargs):calls.append(args);raise OSError('fixture')
            worker=maintenance.Maintenance(run=fail,start_scheduler=False);worker.work('rebuild')
            self.assertEqual(calls[0][-1],'ml/build_index.py');self.assertEqual(worker.snapshot()['status'],'failed')
            with corpus_lease(Path(directory)/'reports/corpus-update.lock'):pass
    def test_lease_prevents_two_workers_from_writing_the_same_corpus(self):
        with tempfile.TemporaryDirectory() as directory,patch.object(maintenance,'DATA',Path(directory)):
            root=Path(directory)/'reports'
            with corpus_lease(root/'corpus-update.lock'):
                worker=maintenance.Maintenance(run=lambda *a,**k:self.fail('must not run'),start_scheduler=False);worker.work('rebuild')
                self.assertEqual(worker.snapshot()['status'],'failed')

if __name__=='__main__':unittest.main()
