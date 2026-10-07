"""Loopback-only classifier/retrieval and OpenAI-compatible streaming local generator."""
from __future__ import annotations
import argparse, json, os, re, threading, time, queue
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from corpus import ROOT, DATA, clean_text
os.environ.setdefault('HF_HOME',str(DATA/'cache/huggingface'))
os.environ.setdefault('HF_HUB_OFFLINE','1')
os.environ.setdefault('TOKENIZERS_PARALLELISM','false')

def lexical(text):
    words=re.findall(r'[a-z]{2,}|[\u3400-\u9fff]',text.lower())
    return set(words+[a+b for a,b in zip(words,words[1:]) if len(a)==len(b)==1])

class Engine:
    def __init__(self):
        import numpy as np, joblib, torch
        from sentence_transformers import SentenceTransformer
        torch.set_num_threads(6)
        self.encoder=SentenceTransformer(str(ROOT/'models/local/encoder'),device='cpu')
        # Only load our locally trained artifact; never accept uploaded pickle files.
        self.head=joblib.load(ROOT/'models/local/emotion-head.joblib')
        self.docs=json.loads((DATA/'index/documents.json').read_text(encoding='utf-8'))
        self.vectors=np.load(DATA/'index/vectors.npy',allow_pickle=False)
        if len(self.docs)!=len(self.vectors): raise ValueError('Index manifest/vector count mismatch')
        self.tokens=[lexical(d['text']) for d in self.docs]
        self.generator=None; self.tokenizer=None; self.lock=threading.Lock(); self.encoder_lock=threading.Lock()

    def analyze(self,text):
        import numpy as np
        with self.encoder_lock:
            vector=self.encoder.encode([text],normalize_embeddings=True,convert_to_numpy=True)
        probabilities=[float(h.predict_proba(vector)[0,1]) for h in self.head['heads']]
        distribution=sorted(zip(self.head['labels'],probabilities),key=lambda x:-x[1])
        detected=[label for label,score in distribution if score>=.5] or [distribution[0][0]]
        terms=lexical(text); cosine=self.vectors@vector[0]
        rankings=[]
        for i,doc in enumerate(self.docs):
            overlap=len(terms & self.tokens[i])/max(1,len(terms))
            affect=len(set(doc['emotions']) & set(detected))/max(1,len(detected))
            score=.75*float(cosine[i])+.15*overlap+.1*affect
            # Emotional relevance is a gate, not only a tiny bonus for unrelated technical Q&A.
            if len(text)>=8 and affect>0 and cosine[i]>=.35 and score>=.38: rankings.append((score,i))
        rankings.sort(reverse=True)
        # Source diversity prevents multiple replies from one tree dominating the prompt.
        hits=[]; groups=set()
        for score,i in rankings:
            doc=self.docs[i]
            if doc['group'] in groups: continue
            groups.add(doc['group'])
            hits.append({k:doc[k] for k in ['id','text','response','source','source_url','license','language','emotions','category']} | {'score':round(score,4)})
            if len(hits)==3: break
        return {'emotion':distribution[0][0],'confidence':round(distribution[0][1],4),'scores':dict(distribution),
            'label_source':'local-trained-head','hits':hits,'index_size':len(self.docs)}

    def load_generator(self):
        if self.generator is not None: return
        import torch
        from transformers import AutoTokenizer,AutoModelForCausalLM
        from peft import PeftModel
        report=json.loads((DATA/'reports/generator.json').read_text(encoding='utf-8'))
        adapter=ROOT/'models/local/generator-adapter'
        self.tokenizer=AutoTokenizer.from_pretrained(adapter,local_files_only=True)
        model=AutoModelForCausalLM.from_pretrained(ROOT/'models/local/generator-base',local_files_only=True,
            torch_dtype=torch.bfloat16 if torch.cuda.is_available() else torch.float32,attn_implementation='sdpa')
        self.generator=PeftModel.from_pretrained(model,adapter).to('cuda' if torch.cuda.is_available() else 'cpu').eval()

engine=None
class Handler(BaseHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    def log_message(self,*args): pass
    def json(self,status,value):
        payload=json.dumps(value,ensure_ascii=False).encode()
        self.send_response(status); self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(payload)))
        self.send_header('Cache-Control','no-store'); self.end_headers(); self.wfile.write(payload)
    def allowed(self):
        return bool(re.fullmatch(r'(127\.0\.0\.1|localhost)(:\d+)?',self.headers.get('Host',''))) and not self.headers.get('Origin')
    def do_GET(self):
        if not self.allowed(): return self.json(403,{'error':'Loopback API only'})
        if self.path=='/health': return self.json(200,{'ok':True,'classifier':True,'index_documents':len(engine.docs),
            'generator':(ROOT/'models/local/generator-adapter/adapter_config.json').exists(),'generator_loaded':engine.generator is not None})
        self.json(404,{'error':'Not found'})
    def do_POST(self):
        if not self.allowed(): return self.json(403,{'error':'Loopback API only'})
        try:
            size=int(self.headers.get('Content-Length','0'))
            if not 0<size<=128000: return self.json(413,{'error':'Body too large'})
            if not self.headers.get('Content-Type','').startswith('application/json'): return self.json(415,{'error':'JSON required'})
            body=json.loads(self.rfile.read(size))
            if self.path=='/analyze':
                text=body.get('text')
                if not isinstance(text,str) or not 1<=len(text)<=4000: return self.json(400,{'error':'Invalid text'})
                return self.json(200,engine.analyze(text))
            if self.path!='/v1/chat/completions': return self.json(404,{'error':'Not found'})
            messages=body.get('messages')
            if not isinstance(messages,list) or not 1<=len(messages)<=25 or any(m.get('role') not in ['system','user','assistant'] or not isinstance(m.get('content'),str) for m in messages):
                return self.json(400,{'error':'Invalid messages'})
            # Cancellation closes the upstream socket before the worker finishes its current token.
            # Allow that short cleanup to finish so an immediate retry does not fail spuriously.
            if not engine.lock.acquire(timeout=2): return self.json(429,{'error':'Local generator is busy'})
        except (ValueError,TypeError,AttributeError): return self.json(400,{'error':'Invalid request'})
        except Exception: return self.json(503,{'error':'Local analysis unavailable'})
        self.generate(body,messages)

    def generate(self,body,messages):
        cancel=threading.Event(); worker=None; headers_sent=False
        try:
            import torch
            from transformers import TextIteratorStreamer,StoppingCriteria,StoppingCriteriaList
            engine.load_generator()
            trimmed=list(messages)
            while True:
                prompt=engine.tokenizer.apply_chat_template(trimmed,tokenize=False,add_generation_prompt=True,enable_thinking=False)
                tokens=engine.tokenizer(prompt,return_tensors='pt')
                if tokens['input_ids'].shape[1]<=4096: break
                if len(trimmed)<=2: return self.json(400,{'error':'Local context too long; shorten the message'})
                trimmed.pop(1 if trimmed[0]['role']=='system' else 0)
            tokens=tokens.to(engine.generator.device)
            limit=int(body.get('max_completion_tokens',body.get('max_tokens',512)))
            limit=max(1,min(800,limit))
            class Cancelled(StoppingCriteria):
                def __call__(self,*args,**kwargs): return cancel.is_set()
            streamer=TextIteratorStreamer(engine.tokenizer,skip_prompt=True,skip_special_tokens=True,timeout=1)
            errors=[]; finished=threading.Event(); output=[]
            def run():
                try:
                    with torch.inference_mode():
                        result=engine.generator.generate(**tokens,streamer=streamer,max_new_tokens=limit,
                            do_sample=True,temperature=.7,top_p=.8,top_k=20,repetition_penalty=1.1,
                            stopping_criteria=StoppingCriteriaList([Cancelled()]),pad_token_id=engine.tokenizer.pad_token_id)
                        output.append(result.shape[1]-tokens['input_ids'].shape[1])
                except Exception: errors.append(True)
                finally: finished.set()
            worker=threading.Thread(target=run,daemon=True); worker.start()
            if body.get('stream'):
                self.send_response(200); self.send_header('Content-Type','text/event-stream; charset=utf-8')
                self.send_header('Cache-Control','no-store'); self.send_header('Connection','close'); self.end_headers(); headers_sent=True; self.close_connection=True
            def event(value):
                self.wfile.write(('data: '+json.dumps(value,ensure_ascii=False)+'\n\n').encode()); self.wfile.flush()
            parts=[]; started=time.monotonic()
            while True:
                if time.monotonic()-started>120: cancel.set(); raise TimeoutError()
                try: part=next(streamer)
                except StopIteration: break
                except queue.Empty:
                    if finished.is_set(): break
                    if headers_sent: self.wfile.write(b': ping\n\n'); self.wfile.flush()
                    continue
                parts.append(part)
                if headers_sent and part: event({'choices':[{'delta':{'content':part},'finish_reason':None}]})
            worker.join(timeout=2)
            if errors: raise RuntimeError('Generation failed')
            finish='length' if output and output[0]>=limit else 'stop'
            if headers_sent:
                event({'choices':[{'delta':{},'finish_reason':finish}]}); self.wfile.write(b'data: [DONE]\n\n'); self.wfile.flush()
            else: self.json(200,{'choices':[{'message':{'content':''.join(parts)},'finish_reason':finish}]})
        except (BrokenPipeError,ConnectionResetError,ConnectionAbortedError): cancel.set()
        except Exception:
            cancel.set()
            if not headers_sent: self.json(503,{'error':'Local generation unavailable'})
        finally:
            cancel.set()
            if worker: worker.join() # Do not release the model lock while generation is still active.
            engine.lock.release()

def main():
    global engine
    parser=argparse.ArgumentParser(); parser.add_argument('--port',type=int,default=3001); args=parser.parse_args()
    engine=Engine(); server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    print(f'Local ML service: http://127.0.0.1:{args.port}',flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()

if __name__=='__main__': main()
