"""Loopback-only emotion classification and retrieval. Final answers are generated in the cloud."""
from __future__ import annotations
import argparse, io, json, os, re, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from corpus import ROOT, DATA
os.environ.setdefault('HF_HOME', str(DATA/'cache/huggingface'))
os.environ.setdefault('HF_HUB_OFFLINE', '1')
os.environ.setdefault('TOKENIZERS_PARALLELISM', 'false')

from retrieval import PublicIndex, lexical


class AnalysisBusy(RuntimeError):
    """Bounded admission keeps timed-out clients from building an unlimited inference backlog."""


def embedding_dimension(encoder):
    method = getattr(encoder, 'get_embedding_dimension', None) or getattr(encoder, 'get_sentence_embedding_dimension', None)
    return method() if method else None

class Engine:
    def __init__(self):
        import numpy as np, joblib, torch
        from sentence_transformers import SentenceTransformer
        torch.set_num_threads(6)
        self.encoder = SentenceTransformer(str(ROOT/'models/local/encoder'), device='cpu', local_files_only=True)
        # Only load locally trained artifacts, never uploaded pickle files.
        from model_registry import pointer,verified_model
        self.model_version=pointer()['version']
        self.head = joblib.load(verified_model(self.model_version))
        self.model_lock=threading.Lock()
        self.encoder_lock = threading.Lock()
        self.index_lock = threading.Lock()
        self.refresh_lock = threading.Lock()
        self.next_refresh_at = 0.
        self.analysis_slots = threading.BoundedSemaphore(4)
        self.index_version = None
        self.reload_index()

    def reload_index(self):
        from corpus import digest
        import numpy as np
        root = DATA/'index'; pointer = root/'current.json'
        version = json.loads(pointer.read_text(encoding='utf-8'))['version'] if pointer.exists() else 'legacy'
        if version == self.index_version: return
        if not isinstance(version, str) or (version != 'legacy' and not re.fullmatch(r'[0-9a-f]{32}', version)): raise ValueError('Invalid index version')
        folder = root if version == 'legacy' else root/'versions'/version
        manifest = json.loads((folder/'manifest.json').read_text(encoding='utf-8'))
        raw = (folder/'documents.json').read_bytes(); vec = (folder/'vectors.npy').read_bytes()
        if digest(raw) != manifest['documents_sha256'] or digest(vec) != manifest['vectors_sha256']: raise ValueError('Index integrity check failed')
        docs = json.loads(raw); vectors = np.load(io.BytesIO(vec), allow_pickle=False)
        if not isinstance(docs, list) or vectors.ndim != 2 or len(docs) != len(vectors) or not np.isfinite(vectors).all() or len(docs)!=manifest['documents'] or vectors.shape[1]!=manifest['dimensions']: raise ValueError('Invalid index dimensions')
        if any(not isinstance(d, dict) or not isinstance(d.get('text'), str) or not isinstance(d.get('emotions'), list)
               or any(not isinstance(label, str) for label in d['emotions']) or not isinstance(d.get('group'), str)
               or any(key not in d for key in ('id', 'response', 'source', 'source_url', 'license', 'language', 'category')) for d in docs):
            raise ValueError('Invalid index documents')
        dimension = embedding_dimension(self.encoder)
        if dimension is not None and vectors.shape[1]!=dimension: raise ValueError('Encoder/index dimensions differ')
        snapshot = PublicIndex(docs, vectors)
        with self.index_lock:
            self.docs, self.vectors, self.tokens, self.index_version = docs, vectors, snapshot.tokens, version
            self.index = snapshot

    def refresh(self):
        # One request checks immutable artifact pointers; others keep using the last verified snapshot.
        lock = getattr(self, 'refresh_lock', None)
        if lock is not None:
            if time.monotonic() < self.next_refresh_at or not lock.acquire(blocking=False):
                return
        try:
            if lock is not None:
                if time.monotonic() < self.next_refresh_at:
                    return
                self.next_refresh_at = time.monotonic() + .5
            if hasattr(self, 'index_version'):
                try: self.reload_index()
                except (ValueError, OSError, KeyError): pass
            if hasattr(self, 'model_version'):
                try: self.reload_model()
                except (ValueError, OSError, KeyError): pass
        finally:
            if lock is not None:
                self.next_refresh_at = time.monotonic() + .5
                lock.release()

    def analyze(self, text, query=None, memories=None):
        slots = getattr(self, 'analysis_slots', None)
        if slots is not None and not slots.acquire(blocking=False):
            raise AnalysisBusy('Local analysis capacity reached')
        try:
            return self._analyze(text, query, memories)
        finally:
            if slots is not None:
                slots.release()

    def _analyze(self, text, query=None, memories=None):
        started = time.perf_counter()
        memories = memories or []; query = query or text
        self.refresh()
        # Private texts are encoded in this request only, never cached, saved or mixed into the public index.
        texts = [text] + ([query] if query != text else []) + [m['text'] for m in memories]
        unique = list(dict.fromkeys(texts))
        if not self.encoder_lock.acquire(timeout=8):
            raise AnalysisBusy('Local encoder wait expired')
        try:
            encoded_vectors = self.encoder.encode(unique, batch_size=32, normalize_embeddings=True, convert_to_numpy=True)
        finally:
            self.encoder_lock.release()
        positions = {value: index for index, value in enumerate(unique)}
        vectors = encoded_vectors[[positions[value] for value in texts]]
        vector = vectors[:1]; query_vector = vectors[1] if query != text else vectors[0]
        offset = 2 if query != text else 1
        encoded = time.perf_counter()
        head=self.head
        probabilities = [float(h.predict_proba(vector)[0,1]) for h in head['heads']]
        distribution = sorted(zip(head['labels'], probabilities), key=lambda x:-x[1])
        detected = [label for label,score in distribution if score>=.5] or [distribution[0][0]]
        snapshot = getattr(self, 'index', None)
        if snapshot is None:  # Also supports lightweight engines without model artifacts in tests.
            snapshot = PublicIndex(self.docs, self.vectors)
        hits = snapshot.search(query, query_vector, detected)
        memory_hits = sorted([{'id':m['id'],'score':round(max(-1.,min(1.,float(vectors[offset+i]@query_vector))),4)} for i,m in enumerate(memories)],key=lambda h:-h['score'])
        return {'emotion':distribution[0][0], 'confidence':round(distribution[0][1],4), 'scores':dict(distribution),
            'label_source':'local-trained-head', 'hits':hits, 'index_size':len(snapshot.documents), 'memory_hits':memory_hits,
            'timings':{'encodeMs':round((encoded-started)*1000,2),'searchMs':round((time.perf_counter()-encoded)*1000,2)}}

    def reload_model(self):
        import joblib
        from model_registry import pointer,verified_model
        from corpus import LABELS
        version=pointer()['version']
        if version==self.model_version:return
        candidate=joblib.load(verified_model(version))
        dimension=embedding_dimension(self.encoder)
        if not isinstance(candidate, dict) or candidate.get('labels')!=LABELS or not isinstance(candidate.get('heads'), list) or len(candidate['heads'])!=len(LABELS) or any(getattr(h,'n_features_in_',None)!=dimension for h in candidate['heads']):raise ValueError('Incompatible classifier')
        with self.model_lock:self.head,self.model_version=candidate,version

engine = None
maintenance = None
class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *args): pass
    def json(self, status, value):
        payload = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(status); self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(payload)))
        self.send_header('Cache-Control','no-store'); self.end_headers(); self.wfile.write(payload)
    def allowed(self):
        return bool(re.fullmatch(r'(127\.0\.0\.1|localhost)(:\d+)?',self.headers.get('Host',''))) and not self.headers.get('Origin')
    def do_GET(self):
        if not self.allowed(): return self.json(403, {'error':'Loopback API only'})
        if self.path=='/maintenance':
            from model_registry import status
            return self.json(200,maintenance.snapshot() | {'model':status()}) if maintenance else self.json(503,{'error':'Maintenance unavailable'})
        if self.path=='/health': return self.json(200, {'ok':True, 'role':'emotion-rag', 'classifier':True,
            'index_documents':len(engine.docs), 'api_version':3, 'model_version':getattr(engine,'model_version','legacy'), 'index_version':getattr(engine,'index_version','legacy'), 'generator':False, 'generator_loaded':False})
        self.json(404, {'error':'Not found'})
    def do_POST(self):
        if not self.allowed():
            self.close_connection=True
            return self.json(403, {'error':'Loopback API only'})
        try:
            size = int(self.headers.get('Content-Length','0'))
            if not 0<size<=160000:
                self.close_connection=True
                return self.json(413, {'error':'Body too large'})
            if not self.headers.get('Content-Type','').startswith('application/json'):
                self.close_connection=True
                return self.json(415, {'error':'JSON required'})
            body = json.loads(self.rfile.read(size))
            if self.path=='/maintenance':
                if not maintenance:return self.json(503,{'error':'Maintenance unavailable'})
                if not isinstance(body,dict):raise ValueError('Invalid operation')
                if set(body)=={'scheduleHours'}:return self.json(200,maintenance.configure(body['scheduleHours']))
                if set(body)!={'action'}:raise ValueError('Invalid operation')
                accepted=maintenance.start(body['action'])
                return self.json(202 if accepted else 409,maintenance.snapshot())
            if self.path=='/v1/chat/completions': return self.json(410, {'error':'Local generation retired; use /analyze for emotion RAG and your configured cloud model for replies'})
            if self.path!='/analyze': return self.json(404, {'error':'Not found'})
            text = body.get('text')
            if not isinstance(text,str) or not 1<=len(text)<=4000: return self.json(400, {'error':'Invalid text'})
            query = body.get('query',text); memories = body.get('memories',[])
            if not isinstance(query,str) or not 1<=len(query)<=4000 or not isinstance(memories,list) or len(memories)>80: return self.json(400, {'error':'Invalid retrieval context'})
            if any(not isinstance(m,dict) or set(m)!={'id','text'} or not isinstance(m['id'],str) or not re.fullmatch(r'[0-9a-f-]{36}',m['id']) or not isinstance(m['text'],str) or not 1<=len(m['text'])<=500 for m in memories): return self.json(400, {'error':'Invalid private memory candidates'})
            return self.json(200, engine.analyze(text,query,memories) if 'query' in body or 'memories' in body else engine.analyze(text))
        except (ValueError,TypeError,AttributeError): return self.json(400, {'error':'Invalid request'})
        except (BrokenPipeError,ConnectionResetError,ConnectionAbortedError): pass
        except Exception: return self.json(503, {'error':'Local analysis unavailable'})

def main():
    global engine,maintenance
    from maintenance import Maintenance
    parser = argparse.ArgumentParser(); parser.add_argument('--port',type=int,default=3001); args=parser.parse_args()
    engine=Engine(); maintenance=Maintenance(); server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    print(f'Local emotion RAG: http://127.0.0.1:{args.port}',flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()

if __name__=='__main__': main()
