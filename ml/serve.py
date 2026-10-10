"""Loopback-only emotion classification and retrieval. Final answers are generated in the cloud."""
from __future__ import annotations
import argparse, json, os, re, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from corpus import ROOT, DATA
os.environ.setdefault('HF_HOME', str(DATA/'cache/huggingface'))
os.environ.setdefault('HF_HUB_OFFLINE', '1')
os.environ.setdefault('TOKENIZERS_PARALLELISM', 'false')

def lexical(text):
    words = re.findall(r'[a-z]{2,}|[\u3400-\u9fff]', text.lower())
    return set(words + [a+b for a,b in zip(words,words[1:]) if len(a)==len(b)==1])

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
        self.index_version = None
        self.reload_index()

    def reload_index(self):
        from corpus import digest
        import numpy as np
        root = DATA/'index'; pointer = root/'current.json'
        version = json.loads(pointer.read_text(encoding='utf-8'))['version'] if pointer.exists() else 'legacy'
        if version == self.index_version: return
        if version != 'legacy' and not re.fullmatch(r'[0-9a-f]{32}', version): raise ValueError('Invalid index version')
        folder = root if version == 'legacy' else root/'versions'/version
        manifest = json.loads((folder/'manifest.json').read_text(encoding='utf-8'))
        raw = (folder/'documents.json').read_bytes(); vec = (folder/'vectors.npy').read_bytes()
        if digest(raw) != manifest['documents_sha256'] or digest(vec) != manifest['vectors_sha256']: raise ValueError('Index integrity check failed')
        docs = json.loads(raw); vectors = np.load(folder/'vectors.npy', allow_pickle=False)
        if len(docs) != len(vectors) or vectors.ndim != 2 or not np.isfinite(vectors).all() or len(docs)!=manifest['documents'] or vectors.shape[1]!=manifest['dimensions']: raise ValueError('Invalid index dimensions')
        if hasattr(self.encoder,'get_sentence_embedding_dimension') and vectors.shape[1]!=self.encoder.get_sentence_embedding_dimension(): raise ValueError('Encoder/index dimensions differ')
        tokens = [lexical(d['text']) for d in docs]
        with self.index_lock:
            self.docs, self.vectors, self.tokens, self.index_version = docs, vectors, tokens, version

    def analyze(self, text, query=None, memories=None):
        started = time.perf_counter()
        memories = memories or []; query = query or text
        if hasattr(self, 'index_version'):
            try: self.reload_index()
            except (ValueError, OSError, KeyError): pass  # Keep the last verified snapshot during a failed update.
        if hasattr(self,'model_version'):
            try:self.reload_model()
            except (ValueError,OSError,KeyError):pass
        # Private texts are encoded in this request only, never cached, saved or mixed into the public index.
        texts = [text] + ([query] if query != text else []) + [m['text'] for m in memories]
        with self.encoder_lock:
            vectors = self.encoder.encode(texts, batch_size=32, normalize_embeddings=True, convert_to_numpy=True)
        vector = vectors[:1]; query_vector = vectors[1] if query != text else vectors[0]
        offset = 2 if query != text else 1
        encoded = time.perf_counter()
        head=self.head
        probabilities = [float(h.predict_proba(vector)[0,1]) for h in head['heads']]
        distribution = sorted(zip(head['labels'], probabilities), key=lambda x:-x[1])
        detected = [label for label,score in distribution if score>=.5] or [distribution[0][0]]
        if hasattr(self, 'index_lock'):
            with self.index_lock: docs, public_vectors, tokens = self.docs, self.vectors, self.tokens
        else: docs, public_vectors, tokens = self.docs, self.vectors, self.tokens
        terms = lexical(query); cosine = public_vectors@query_vector
        rankings = []
        for i,doc in enumerate(docs):
            overlap = len(terms & tokens[i])/max(1,len(terms))
            affect = len(set(doc['emotions']) & set(detected))/max(1,len(detected))
            score = .75*float(cosine[i])+.15*overlap+.1*affect
            if len(query)>=8 and affect>0 and cosine[i]>=.35 and score>=.38: rankings.append((score,i))
        rankings.sort(reverse=True)
        hits = []; groups = set()
        for score,i in rankings:
            doc = docs[i]
            if doc['group'] in groups: continue
            groups.add(doc['group'])
            hits.append({k:doc[k] for k in ['id','text','response','source','source_url','license','language','emotions','category']} | {'score':round(score,4)})
            if len(hits)==3: break
        memory_hits = sorted([{'id':m['id'],'score':round(max(-1.,min(1.,float(vectors[offset+i]@query_vector))),4)} for i,m in enumerate(memories)],key=lambda h:-h['score'])
        return {'emotion':distribution[0][0], 'confidence':round(distribution[0][1],4), 'scores':dict(distribution),
            'label_source':'local-trained-head', 'hits':hits, 'index_size':len(docs), 'memory_hits':memory_hits,
            'timings':{'encodeMs':round((encoded-started)*1000,2),'searchMs':round((time.perf_counter()-encoded)*1000,2)}}

    def reload_model(self):
        import joblib
        from model_registry import pointer,verified_model
        from corpus import LABELS
        version=pointer()['version']
        if version==self.model_version:return
        candidate=joblib.load(verified_model(version))
        dimension=self.encoder.get_sentence_embedding_dimension()
        if candidate.get('labels')!=LABELS or len(candidate.get('heads',[]))!=len(LABELS) or any(h.n_features_in_!=dimension for h in candidate['heads']):raise ValueError('Incompatible classifier')
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
