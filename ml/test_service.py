import json, threading, unittest
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
    def test_validation_and_cross_origin_requests(self):
        for body in [None,[],{}, {'text':2},{'text':'x'*4001}]:
            if body is not None:self.assertEqual(self.request('/analyze',body)[0],400)
        self.assertEqual(self.request('/analyze',{'text':'hello'},{'Origin':'http://example.org'})[0],403)

if __name__=='__main__':unittest.main()
