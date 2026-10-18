import json, threading, unittest, uuid
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from http.server import ThreadingHTTPServer
from unittest.mock import patch
from types import SimpleNamespace
import serve

class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.fixture=SimpleNamespace(docs=[{}],analyze=lambda text: {'emotion':'fear','confidence':.8,'hits':[]})
        self.mock=patch.object(serve,'engine',self.fixture);self.mock.start()
        self.server=ThreadingHTTPServer(('127.0.0.1',0),serve.Handler)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.url=f'http://127.0.0.1:{self.server.server_port}'
    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join();self.mock.stop()
    def request(self,path,body=None,headers=None):
        req=Request(self.url+path,data=None if body is None else json.dumps(body).encode(),headers={'Content-Type':'application/json',**(headers or {})})
        try:
            with urlopen(req,timeout=3) as r:return r.status,json.load(r)
        except HTTPError as e:
            with e:return e.code,json.load(e)
    def test_rag_health_does_not_depend_on_or_offer_generator(self):
        status,data=self.request('/health');self.assertEqual(status,200)
        self.assertEqual(data['role'],'emotion-rag');self.assertFalse(data['generator']);self.assertFalse(data['generator_loaded'])
    def test_analysis_and_retired_generation_endpoint(self):
        self.assertEqual(self.request('/analyze',{'text':'work stress'})[0],200)
        self.assertEqual(self.request('/v1/chat/completions',{'messages':[]})[0],410)
        self.assertFalse(hasattr(serve.Engine,'load_generator'))
    def test_saturated_analysis_returns_retryable_unavailable_without_private_data(self):
        with patch.object(self.fixture,'analyze',side_effect=serve.AnalysisBusy('private fixture')):
            status,data=self.request('/analyze',{'text':'work stress'})
            self.assertEqual(status,503)
            self.assertEqual(data,{'error':'Local analysis unavailable'})
    def test_validation_and_cross_origin_requests(self):
        for body in [None,[],{}, {'text':2},{'text':'x'*4001}]:
            if body is not None:self.assertEqual(self.request('/analyze',body)[0],400)
        self.assertEqual(self.request('/analyze',{'text':'hello'},{'Origin':'http://example.org'})[0],403)
        for body in [{'text':'hello','memories':[{'id':'not-uuid','text':'x'}]},{'text':'hello','query':5},{'text':'hello','memories':[{}]*301}]:
            self.assertEqual(self.request('/analyze',body)[0],400)
    def test_full_owner_unicode_candidates_are_accepted_without_truncation(self):
        memories=[{'id':str(uuid.UUID(int=i+1)),'text':'情绪记忆跨会话' * 71 + '情绪记'} for i in range(300)]
        self.assertTrue(all(len(m['text'])==500 for m in memories))
        encoded=json.dumps({'text':'继续回顾','memories':memories}).encode()
        self.assertGreater(len(encoded),450000)
        with patch.object(self.fixture,'analyze',return_value={'memory_hits':[{'id':m['id'],'score':.5} for m in memories]}) as analyze:
            status,data=self.request('/analyze',{'text':'继续回顾','memories':memories})
            self.assertEqual(status,200);self.assertEqual(len(data['memory_hits']),300)
            self.assertEqual(analyze.call_args.args[2],memories)
        self.assertEqual(self.request('/analyze',{'text':'hello','memories':memories+[{'id':str(uuid.UUID(int=301)),'text':'extra'}]})[0],400)
        self.assertEqual(self.request('/analyze',{'text':'hello','memories':[memories[0],memories[0]]})[0],400)
    def test_body_size_remains_bounded(self):
        self.assertEqual(self.request('/analyze',{'text':'x'*serve.MAX_ANALYSIS_BODY_BYTES})[0],413)

if __name__=='__main__':unittest.main()
