"""Resume a pinned public snapshot with four bounded range requests and a final SHA256 check."""
import concurrent.futures,json,time,requests
from corpus import ROOT,DATA,digest

def main():
    source=next(s for s in json.loads((ROOT/'ml/sources.json').read_text(encoding='utf-8'))['sources'] if s['id']=='oasst2')
    url=source['mirror_url']; total=54301900; chunk_size=2*1024*1024
    target=DATA/'cache'/digest(url); parts=DATA/'cache'/(digest(url)+'.chunks');parts.mkdir(parents=True,exist_ok=True)
    if target.exists() and digest(target.read_bytes())==source['sha256']:return
    def part(i):
        start=i*chunk_size; end=min(total,start+chunk_size)-1; path=parts/str(i)
        if path.exists() and path.stat().st_size==end-start+1:return path
        for attempt in range(4):
            try:
                with requests.get(url,headers={'Range':f'bytes={start}-{end}','User-Agent':'EmpathyCorpusResearch/1.0'},timeout=(15,90)) as response:
                    response.raise_for_status()
                    if response.status_code!=206 or response.headers.get('Content-Range')!=f'bytes {start}-{end}/{total}':raise ValueError('Invalid byte-range response')
                    if len(response.content)!=end-start+1:raise ValueError('Incomplete byte range')
                    path.write_bytes(response.content)
                    print(json.dumps({'range':i,'bytes':len(response.content)}),flush=True)
                    return path
            except (requests.RequestException,ValueError):
                if attempt==3:raise
                time.sleep(2**attempt)
    count=(total+chunk_size-1)//chunk_size
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool: paths=list(pool.map(part,range(count)))
    payload=b''.join(path.read_bytes() for path in paths)
    if digest(payload)!=source['sha256']:raise ValueError('Snapshot SHA256 mismatch')
    temp=target.with_suffix('.tmp');temp.write_bytes(payload);temp.replace(target)
    print('Pinned OASST2 snapshot verified.',flush=True)

if __name__=='__main__':main()
