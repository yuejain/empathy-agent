"""Loopback-only emotion classification and retrieval. Final answers are generated in the cloud."""
from __future__ import annotations
import argparse, json, os, re, threading
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
        self.head = joblib.load(ROOT/'models/local/emotion-head.joblib')
        self.docs = json.loads((DATA/'index/documents.json').read_text(encoding='utf-8'))
        self.vectors = np.load(DATA/'index/vectors.npy', allow_pickle=False)
        if len(self.docs) != len(self.vectors): raise ValueError('Index manifest/vector count mismatch')
        self.tokens = [lexical(d['text']) for d in self.docs]
        self.encoder_lock = threading.Lock()

    def analyze(self, text):
        with self.encoder_lock:
            vector = self.encoder.encode([text], normalize_embeddings=True, convert_to_numpy=True)
        probabilities = [float(h.predict_proba(vector)[0,1]) for h in self.head['heads']]
        distribution = sorted(zip(self.head['labels'], probabilities), key=lambda x:-x[1])
        detected = [label for label,score in distribution if score>=.5] or [distribution[0][0]]
        terms = lexical(text); cosine = self.vectors@vector[0]
        rankings = []
        for i,doc in enumerate(self.docs):
            overlap = len(terms & self.tokens[i])/max(1,len(terms))
            affect = len(set(doc['emotions']) & set(detected))/max(1,len(detected))
            score = .75*float(cosine[i])+.15*overlap+.1*affect
            if len(text)>=8 and affect>0 and cosine[i]>=.35 and score>=.38: rankings.append((score,i))
        rankings.sort(reverse=True)
        hits = []; groups = set()
        for score,i in rankings:
            doc = self.docs[i]
            if doc['group'] in groups: continue
            groups.add(doc['group'])
            hits.append({k:doc[k] for k in ['id','text','response','source','source_url','license','language','emotions','category']} | {'score':round(score,4)})
            if len(hits)==3: break
        return {'emotion':distribution[0][0], 'confidence':round(distribution[0][1],4), 'scores':dict(distribution),
            'label_source':'local-trained-head', 'hits':hits, 'index_size':len(self.docs)}

engine = None
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
        if self.path=='/health': return self.json(200, {'ok':True, 'role':'emotion-rag', 'classifier':True,
            'index_documents':len(engine.docs), 'generator':False, 'generator_loaded':False})
        self.json(404, {'error':'Not found'})
    def do_POST(self):
        if not self.allowed(): return self.json(403, {'error':'Loopback API only'})
        try:
            size = int(self.headers.get('Content-Length','0'))
            if not 0<size<=16000:
                self.close_connection=True
                return self.json(413, {'error':'Body too large'})
            if not self.headers.get('Content-Type','').startswith('application/json'):
                self.close_connection=True
                return self.json(415, {'error':'JSON required'})
            body = json.loads(self.rfile.read(size))
            if self.path=='/v1/chat/completions': return self.json(410, {'error':'Local generation retired; use /analyze for emotion RAG and your configured cloud model for replies'})
            if self.path!='/analyze': return self.json(404, {'error':'Not found'})
            text = body.get('text')
            if not isinstance(text,str) or not 1<=len(text)<=4000: return self.json(400, {'error':'Invalid text'})
            return self.json(200, engine.analyze(text))
        except (ValueError,TypeError,AttributeError): return self.json(400, {'error':'Invalid request'})
        except (BrokenPipeError,ConnectionResetError,ConnectionAbortedError): pass
        except Exception: return self.json(503, {'error':'Local analysis unavailable'})

def main():
    global engine
    parser = argparse.ArgumentParser(); parser.add_argument('--port',type=int,default=3001); args=parser.parse_args()
    engine=Engine(); server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    print(f'Local emotion RAG: http://127.0.0.1:{args.port}',flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()

if __name__=='__main__': main()
