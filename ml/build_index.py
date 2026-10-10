"""Rebuild retrieval artifacts without retraining or touching the classifier's evaluation."""
import collections,json,re,uuid
from corpus import ROOT,DATA,read_jsonl,write_json,digest

def build(encoder,rows):
    import numpy as np
    eligible=[r for r in rows if r['split']=='train' and (r['category']=='literature' or r['response'])]
    candidates={lang:sorted([r for r in eligible if r['language']==lang],key=lambda r:(r['category']=='literature',not bool(r['emotions']),r['id'])) for lang in ['zh','en']}
    per_language=min(2000,*(len(group) for group in candidates.values()))
    if not per_language: raise ValueError('Both languages need training-partition retrieval documents')
    documents=sorted(candidates['zh'][:per_language]+candidates['en'][:per_language],key=lambda r:r['id'])
    retrieval_terms={
      'fear':r'焦虑|焦慮|担心|擔心|紧张|緊張|壓力|压力|恐惧|恐懼|忧虑|憂慮|\banxiety\b|\banxious\b|\bnervous\b|\bworr(?:y|ied)\b|\bfear\b',
      'sadness':r'悲伤|悲傷|孤独|孤獨|寂寞|難過|难过|悲愁|愁|\bsad(?:ness)?\b|\blonel(?:y|iness)\b|\bdepress(?:ed|ion)\b|\bgrief\b',
      'anger':r'愤怒|憤怒|生气|生氣|怨恨|\bang(?:ry|er)\b|\bfrustrat(?:ed|ion)\b',
      'joy':r'开心|開心|快乐|快樂|高兴|高興|喜悦|喜悅|感激|\bhapp(?:y|iness)\b|\bgrateful\b|\bjoy\b',
      'love':r'关爱|關愛|被爱|被愛|\blove\b|\bcaring\b',
      'confusion':r'迷茫|困惑|犹豫|猶豫|\bconfus(?:ed|ion)\b|\buncertain\b',
      'surprise':r'惊讶|驚訝|吃惊|吃驚|\bsurpris(?:e|ed)\b',
    }
    for row in documents:
        row['emotions']=sorted(set(row['emotions'])|{label for label,pattern in retrieval_terms.items() if re.search(pattern,row['text'],re.I)})
        row['retrieval_label_origin']='source-labels-plus-index-keywords'
    vectors=encoder.encode([r['text'] for r in documents],batch_size=48,normalize_embeddings=True,show_progress_bar=True,convert_to_numpy=True)
    root=DATA/'index';version=uuid.uuid4().hex
    index=root/'versions'/version;index.mkdir(parents=True,exist_ok=True)
    np.save(index/'vectors.npy',vectors.astype(np.float32),allow_pickle=False);write_json(index/'documents.json',documents)
    metadata={'documents':len(documents),'languages':dict(collections.Counter(r['language'] for r in documents)),
        'categories':dict(collections.Counter(r['category'] for r in documents)),'dimensions':vectors.shape[1],
        'corpus_sha256':digest((DATA/'processed/corpus.jsonl').read_bytes()),'split':'train-only',
        'documents_sha256':digest((index/'documents.json').read_bytes()),'vectors_sha256':digest((index/'vectors.npy').read_bytes())}
    write_json(index/'manifest.json',metadata)
    # Publish an immutable, fully written snapshot with one atomic pointer replacement.
    pointer=root/'current.json.tmp';write_json(pointer,{'version':version});pointer.replace(root/'current.json')
    report_path=DATA/'reports/classifier.json'
    if report_path.exists():
        report=json.loads(report_path.read_text(encoding='utf-8'))
        if report['corpus_sha256']==metadata['corpus_sha256']:
            report.update(index_documents=metadata['documents'],index_languages=metadata['languages'])
            write_json(report_path,report)
    return metadata

if __name__=='__main__':
    import torch
    from sentence_transformers import SentenceTransformer
    torch.set_num_threads(6)
    encoder=SentenceTransformer(str(ROOT/'models/local/encoder'),device='cpu',local_files_only=True)
    metadata=build(encoder,list(read_jsonl(DATA/'processed/corpus.jsonl')))
    print(json.dumps(metadata,ensure_ascii=False,indent=2))
