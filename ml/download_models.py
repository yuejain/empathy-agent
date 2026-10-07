"""Download publisher models via ModelScope; verify each file against a pinned HF snapshot."""
import hashlib, json, os, time
from pathlib import Path
import requests
from corpus import ROOT, write_json

def download(repo, directory):
    info=requests.get('https://huggingface.co/api/models/'+repo+'?blobs=true',timeout=45)
    info.raise_for_status(); info=info.json(); target=ROOT/'models/local'/directory; target.mkdir(parents=True,exist_ok=True)
    entries=[]
    for file in info['siblings']:
        name=file['rfilename']
        if not (name.endswith(('.json','.txt','.model','.safetensors','.md')) or name in ['LICENSE','NOTICE']): continue
        if any(name.startswith(p) for p in ['onnx/','openvino/','onnx_', 'onnx-']): continue
        if name.endswith('.safetensors') and name!='model.safetensors': continue
        if name.startswith('.') or '..' in Path(name).parts: continue
        expected=(file.get('lfs') or {}).get('sha256')
        destination=target/name; destination.parent.mkdir(parents=True,exist_ok=True)
        # Large tensors may use the publisher's ModelScope mirror. Small config files use the pinned original.
        url=(f'https://modelscope.cn/models/{repo}/resolve/master/{name}' if expected and file.get('size',0)>1000000
             else f'https://huggingface.co/{repo}/resolve/{info["sha"]}/{name}')
        def valid(path):
            if not path.exists(): return False
            if expected:
                h=hashlib.sha256()
                with path.open('rb') as handle:
                    for block in iter(lambda:handle.read(1024*1024),b''): h.update(block)
                return h.hexdigest()==expected
            raw=path.read_bytes()
            return hashlib.sha1(f'blob {len(raw)}\0'.encode()+raw).hexdigest()==file['blobId']
        if not valid(destination):
            temp=destination.with_suffix(destination.suffix+'.part')
            for attempt in range(4):
                try:
                    with requests.get(url,stream=True,timeout=(15,120)) as response:
                        response.raise_for_status()
                        with temp.open('wb') as handle:
                            for block in response.iter_content(1024*1024):handle.write(block)
                    if not valid(temp): raise ValueError(f'Hash mismatch for {repo}/{name}')
                    temp.replace(destination); break
                except requests.RequestException:
                    if attempt==3:raise
                    time.sleep(2**attempt)
        entries.append({'file':name,'sha256':hashlib.sha256(destination.read_bytes()).hexdigest()})
        print(json.dumps({'repo':repo,'file':name,'bytes':destination.stat().st_size}),flush=True)
    write_json(target/'download-manifest.json',{'repo':repo,'revision':info['sha'],'files':entries})

if __name__=='__main__':
    download('sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2','encoder-base')
    download('Qwen/Qwen3-0.6B','generator-base')
