"""Bounded, cached public-source collectors; clean records never retain author/account IDs."""
from __future__ import annotations
import argparse, collections, csv, gzip, hashlib, html, io, json, re, time, unicodedata
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit, urljoin, quote
from urllib.robotparser import RobotFileParser
import requests

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data'
USER_AGENT = 'EmpathyCorpusResearch/1.0 (bounded local dataset ingestion; no login)'
LABELS = ['joy', 'sadness', 'anger', 'fear', 'love', 'surprise', 'confusion', 'neutral']
LEXICON = {
 'joy': ['开心','快乐','高兴','喜悦','感激','感恩','happy','joy','grateful','excited'],
 'sadness': ['难过','悲伤','失落','孤独','沮丧','伤心','sad','lonely','grief','depressed'],
 'anger': ['生气','愤怒','恼火','气愤','angry','furious','annoyed'],
 'fear': ['焦虑','担心','害怕','紧张','恐惧','anxious','afraid','worried','nervous'],
 'love': ['关爱','关心','珍惜','温暖','爱你','love','caring','affection'],
 'surprise': ['惊讶','意外','吃惊','surprised','astonished'],
 'confusion': ['困惑','迷茫','犹豫','纠结','confused','uncertain'],
}
GO_GROUP = {
 'admiration':'love','amusement':'joy','anger':'anger','annoyance':'anger','approval':'joy','caring':'love',
 'confusion':'confusion','curiosity':'confusion','desire':'love','disappointment':'sadness','disapproval':'anger',
 'disgust':'anger','embarrassment':'fear','excitement':'joy','fear':'fear','gratitude':'joy','grief':'sadness',
 'joy':'joy','love':'love','nervousness':'fear','optimism':'joy','pride':'joy','realization':'surprise',
 'relief':'joy','remorse':'sadness','sadness':'sadness','surprise':'surprise','neutral':'neutral',
}

def digest(value):
    return hashlib.sha256(value.encode('utf-8') if isinstance(value, str) else value).hexdigest()

def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    temp.replace(path)

def write_jsonl(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.tmp')
    with temp.open('w', encoding='utf-8') as handle:
        for row in rows: handle.write(json.dumps(row, ensure_ascii=False) + '\n')
    temp.replace(path)

def read_jsonl(path):
    with path.open(encoding='utf-8') as handle:
        for line in handle:
            if line.strip(): yield json.loads(line)

class Fetcher:
    def __init__(self, delay=1.0, refresh=False):
        self.session = requests.Session()
        self.session.headers['User-Agent'] = USER_AGENT
        self.delay, self.last, self.receipts, self.robots = delay, {}, [], {}
        self.refresh = refresh

    def get(self, url, limit=100_000_000, robots=False):
        host = urlsplit(url).hostname
        if urlsplit(url).scheme != 'https': raise ValueError('Collectors require HTTPS')
        if robots:
            origin = 'https://' + urlsplit(url).netloc
            if origin not in self.robots:
                response = self.session.get(origin + '/robots.txt', timeout=30)
                if response.status_code == 404: rules = []
                else: response.raise_for_status(); rules = response.text.splitlines()
                parser = RobotFileParser(); parser.parse(rules); self.robots[origin] = parser
            if not self.robots[origin].can_fetch(USER_AGENT, url): raise ValueError('robots.txt disallows this URL')
        cache = DATA / 'cache' / digest(url)
        pinned = bool(re.search(r'/[0-9a-f]{40}/',url))
        refresh = self.refresh and not pinned
        if cache.exists() and not refresh: payload = cache.read_bytes()
        else:
            cache.parent.mkdir(parents=True, exist_ok=True)
            temp = cache.with_suffix('.part')
            for attempt in range(5):
                time.sleep(max(0, self.delay - (time.monotonic() - self.last.get(host, 0))))
                offset = temp.stat().st_size if temp.exists() and not refresh else 0
                try:
                    with self.session.get(url, timeout=(15, 90), stream=True, headers={'Range':f'bytes={offset}-'} if offset else {}) as response:
                        self.last[host] = time.monotonic(); response.raise_for_status()
                        if offset and response.status_code == 206:
                            if not response.headers.get('Content-Range','').startswith(f'bytes {offset}-'): raise ValueError('Invalid resume range')
                        else: offset = 0
                        size = offset
                        with temp.open('ab' if offset else 'wb') as handle:
                            for block in response.iter_content(65536):
                                size += len(block)
                                if size > limit: raise ValueError('Source exceeds configured byte limit')
                                handle.write(block)
                    temp.replace(cache); break
                except requests.RequestException:
                    if attempt == 4: raise
                    time.sleep(min(8, 2 ** attempt))
            payload = cache.read_bytes()
        if len(payload) > limit: raise ValueError('Cached source exceeds configured byte limit')
        self.receipts.append({'url':url,'sha256':digest(payload),'bytes':len(payload),'fetched_or_cache_checked_at':datetime.now(timezone.utc).isoformat()})
        return payload

def clean_text(value):
    text = unicodedata.normalize('NFKC', html.unescape(str(value)))
    text = re.sub(r'<[^>]{0,500}>', ' ', text)
    text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', text)
    text = re.sub(r'\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b', '[EMAIL]', text)
    text = re.sub(r'https?://\S+|www\.\S+', '[URL]', text)
    text = re.sub(r'(?<!\w)(?:\+?\d[\d ()-]{7,}\d)(?!\w)', '[NUMBER]', text)
    text = re.sub(r'(?<!\w)(?:u/|@)[\w-]+', '[USER]', text)
    text = re.sub(r'\b(?:sk|hf)-?[A-Za-z0-9_]{20,}\b', '[TOKEN]', text)
    return re.sub(r'\s+', ' ', text).strip()

def weak_labels(text):
    lower = text.lower()
    return [label for label, words in LEXICON.items() if any((word in lower if re.search('[\u3400-\u9fff]', word) else re.search(r'\b'+word+r'\b', lower)) for word in words)]

def record(source, identifier, text, lang, split, labels=None, response=None, group=None, category='conversation', label_origin=None, url=None):
    return dict(id=digest(source['id']+':'+identifier)[:24], group=group or identifier, source=source['id'],
        source_url=url or source['homepage'], license=source['license'], language=lang, split=split,
        text=text, response=response, emotions=labels or [], label_origin=label_origin or source['label_origin'], category=category,
        human_text=True)

def collect_go(source, fetch):
    commit = json.loads(fetch.get('https://api.github.com/repos/google-research/google-research/commits?path=goemotions/data/train.tsv&per_page=1'))[0]['sha']
    base = f'https://raw.githubusercontent.com/google-research/google-research/{commit}/goemotions/data/'
    names = fetch.get(base+'emotions.txt').decode().splitlines()
    for split, file in [('test','test.tsv'),('validation','dev.tsv'),('train','train.tsv')]:
        for text, indices, identifier in csv.reader(io.StringIO(fetch.get(base+file).decode()), delimiter='\t'):
            labels = sorted({GO_GROUP[names[int(i)]] for i in indices.split(',')})
            yield record(source, identifier, text, 'en', split, labels, group=identifier, category='social-emotion', url=base+file)

def label_value(row, name, default=0):
    labels = row.get('labels') or {}
    if isinstance(labels, dict): return (labels.get(name) or {}).get('value',default)
    return default

def collect_oasst(source, fetch):
    url = source.get('download_url') or f"https://huggingface.co/datasets/OpenAssistant/oasst1/resolve/{source['revision']}/2023-04-12_oasst_ready.messages.jsonl.gz"
    payload = fetch.get(source.get('mirror_url') or url)
    if source.get('sha256') and digest(payload) != source['sha256']: raise ValueError('Dataset SHA256 mismatch')
    rows = {}
    with gzip.GzipFile(fileobj=io.BytesIO(payload)) as stream:
        for line in stream:
            item = json.loads(line)
            if item.get('lang') not in ('en','zh') or item.get('synthetic') or item.get('deleted') or item.get('review_result') is False: continue
            if any(label_value(item, key) > .1 for key in ['pii','spam','hate_speech','sexual_content','violence']): continue
            if label_value(item,'quality',1) < .5: continue
            rows[item['message_id']] = item
    for item in rows.values():
        parent = rows.get(item.get('parent_id'))
        if item['role'] != 'assistant' or not parent or parent['role'] != 'prompter' or parent['lang'] != item['lang']: continue
        if item.get('rank') not in (0,None): continue
        group = item['message_tree_id']
        bucket = int(digest(group)[:8],16) % 100
        split = 'test' if bucket < 10 else 'validation' if bucket < 20 else 'train'
        yield record(source,item['message_id'],parent['text'],item['lang'],split,weak_labels(parent['text']),item['text'],group, 'human-assistant',url=url)

def collect_mediawiki(source, fetch):
    from bs4 import BeautifulSoup
    for title in source['titles']:
        request = requests.Request('GET',source['api'],params={'action':'parse','page':title,'prop':'text|revid','format':'json','redirects':1}).prepare()
        data = json.loads(fetch.get(request.url,robots=True))
        if 'error' in data: raise ValueError(data['error'].get('code','mediawiki error'))
        page = data['parse']; soup = BeautifulSoup(page['text']['*'],'html.parser')
        for tag in soup.select('script,style,.mw-editsection,.navbox,.noprint,table'): tag.decompose()
        url = source['homepage'] + '/w/index.php?oldid=' + str(page['revid'])
        for i, paragraph in enumerate(soup.select('p')):
            text = paragraph.get_text(' ',strip=True)
            if 25 <= len(text) <= 1200:
                yield record(source,f"{page['revid']}:{i}",text,'zh','train',weak_labels(text),group=title,category='literature',url=url)

def collect_poetry(source, fetch):
    commit = json.loads(fetch.get('https://api.github.com/repos/chinese-poetry/chinese-poetry/commits/master'))['sha']
    for filename in source['files']:
        url=f'https://raw.githubusercontent.com/chinese-poetry/chinese-poetry/{commit}/'+quote(filename)
        for i,item in enumerate(json.loads(fetch.get(url))):
            text=item.get('title','')+'。'+''.join(item.get('paragraphs',[]))
            yield record(source,filename+':'+str(i),text,'zh','train',weak_labels(text),group=filename+':'+str(i),category='literature',url=url)

def clean_records(rows):
    stats = collections.Counter(); seen = set(); output = []
    # Evaluation has priority, preventing exact duplicate training leakage.
    for row in sorted(rows,key=lambda x:{'test':0,'validation':1,'train':2}[x['split']]):
        stats['input'] += 1
        row['text'] = clean_text(row['text'])
        if row.get('response'): row['response'] = clean_text(row['response'])
        if not 8 <= len(row['text']) <= 2400 or (row.get('response') and not 8 <= len(row['response']) <= 3200): stats['length_rejected'] += 1; continue
        fingerprint = digest(re.sub(r'\W+','',row['text'].lower()))
        if fingerprint in seen: stats['duplicates'] += 1; continue
        if len(set(row['text'])) < 5: stats['repetition_rejected'] += 1; continue
        seen.add(fingerprint); row['content_hash'] = fingerprint
        # Only group hashes survive; no author/account identifiers are retained.
        row['group'] = digest(row['source'] + ':' + row['group'])[:24]
        output.append(row); stats['kept'] += 1
    return output, dict(stats)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--sources',default=str(ROOT/'ml/sources.json'))
    parser.add_argument('--only',nargs='*')
    parser.add_argument('--refresh',action='store_true',help='Refresh mutable sources; pinned snapshots remain cached')
    args = parser.parse_args()
    config = json.loads(Path(args.sources).read_text(encoding='utf-8'))
    fetch = Fetcher(refresh=args.refresh); rows=[]; failures=[]; selected=[]
    adapters={'goemotions':collect_go,'oasst':collect_oasst,'mediawiki':collect_mediawiki,'poetry':collect_poetry}
    for source in config['sources']:
        if not source['enabled']: continue
        selected.append(source)
        snapshot=DATA/'raw'/f"{source['id']}.jsonl"
        if args.only and source['id'] not in args.only:
            if snapshot.exists(): rows.extend(read_jsonl(snapshot))
            continue
        try:
            collected=list(adapters[source['adapter']](source,fetch)); rows.extend(collected)
            write_jsonl(snapshot,collected)
            print(json.dumps({'source':source['id'],'records':len(collected)}),flush=True)
        except Exception as exc:
            failures.append({'source':source['id'],'error':str(exc)[:200]})
            print(json.dumps(failures[-1]),flush=True)
            if snapshot.exists(): rows.extend(read_jsonl(snapshot))
    cleaned, stats = clean_records(rows)
    if not cleaned: raise SystemExit('No records collected; previous corpus left unchanged.')
    write_jsonl(DATA/'processed/corpus.jsonl',cleaned)
    report={'created_at':datetime.now(timezone.utc).isoformat(),'sources':selected,'receipts':fetch.receipts,'failures':failures,
        'cleaning':stats,'languages':dict(collections.Counter(x['language'] for x in cleaned)),
        'categories':dict(collections.Counter(x['category'] for x in cleaned)),
        'labels':dict(collections.Counter(x['label_origin'] for x in cleaned)),
        'corpus_sha256':digest((DATA/'processed/corpus.jsonl').read_bytes())}
    write_json(DATA/'manifests/corpus.json',report)
    print(json.dumps({k:report[k] for k in ['cleaning','languages','categories','failures']},ensure_ascii=False),flush=True)
    if not cleaned: raise SystemExit('No source was collected; no training should proceed.')

if __name__ == '__main__': main()
