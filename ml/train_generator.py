"""Local Qwen LoRA SFT. Balanced human dialogue pairs; split by entire source tree."""
from __future__ import annotations
import argparse, collections, json, math, os, random, time
from corpus import ROOT, DATA, read_jsonl, write_json, write_jsonl, digest
os.environ.setdefault('HF_HOME',str(DATA/'cache/huggingface'))
os.environ.setdefault('HF_HUB_DISABLE_XET','1')
SYSTEM='你是留白，一个诚实、尊重边界的中英文对话助手。用用户的语言回应；共情时不要诊断、预测命运或制造排他关系。You are a thoughtful assistant. Be honest, supportive and respect user boundaries.'

def prepare(max_per_language=600):
    rows=[r for r in read_jsonl(DATA/'processed/corpus.jsonl') if r['category']=='human-assistant' and r.get('response')]
    selected={}
    rng=random.Random(42)
    for split in ['train','validation','test']:
        by_lang={lang:[r for r in rows if r['language']==lang and r['split']==split] for lang in ['zh','en']}
        for candidates in by_lang.values():
            rng.shuffle(candidates)
            candidates.sort(key=lambda r:not bool(r['emotions']))
        cap=max_per_language if split=='train' else 50
        size=min(cap,*(len(c) for c in by_lang.values()))
        if size<1: raise ValueError(f'Missing bilingual {split} data')
        selected[split]=by_lang['zh'][:size]+by_lang['en'][:size]
        rng.shuffle(selected[split])
        write_jsonl(DATA/f'training/generator-{split}.jsonl',selected[split])
    return selected

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--max-per-language',type=int,default=600)
    parser.add_argument('--steps',type=int,default=160)
    parser.add_argument('--length',type=int,default=384)
    parser.add_argument('--batch-size',type=int,default=2)
    parser.add_argument('--accumulation',type=int,default=4)
    args=parser.parse_args()
    import numpy as np, torch
    from transformers import AutoTokenizer,AutoModelForCausalLM
    from peft import LoraConfig,get_peft_model
    from torch.utils.data import DataLoader
    started=time.time(); random.seed(42); np.random.seed(42); torch.manual_seed(42); torch.set_num_threads(8)
    device='cuda' if torch.cuda.is_available() else 'cpu'
    if device!='cuda': raise RuntimeError('CUDA not available. Configure torch correctly before this training run.')
    rows=prepare(args.max_per_language)
    base='Qwen/Qwen3-0.6B'; base_dir=ROOT/'models/local/generator-base'
    revision=json.loads((base_dir/'download-manifest.json').read_text())['revision']
    tokenizer=AutoTokenizer.from_pretrained(base_dir,local_files_only=True)
    model=AutoModelForCausalLM.from_pretrained(base_dir,local_files_only=True,torch_dtype=torch.bfloat16,attn_implementation='sdpa').to(device)
    model.config.use_cache=False
    model=get_peft_model(model,LoraConfig(r=8,lora_alpha=16,lora_dropout=.05,target_modules=['q_proj','v_proj'],task_type='CAUSAL_LM'))
    model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={'use_reentrant':False})
    model.enable_input_require_grads()
    def tokenize(row):
        prompt=tokenizer.apply_chat_template([{'role':'system','content':SYSTEM},{'role':'user','content':row['text']}],tokenize=False,add_generation_prompt=True,enable_thinking=False)
        prefix=tokenizer.encode(prompt,add_special_tokens=False)
        answer=tokenizer.encode(row['response']+'<|im_end|>',add_special_tokens=False)
        # Reserve answer space; long prompts are excluded, never create all-masked examples.
        if len(prefix)>args.length-48: return None
        ids=(prefix+answer)[:args.length]
        return {'input_ids':ids,'labels':[-100]*len(prefix)+ids[len(prefix):],'language':row['language']}
    sets={}
    for split,group in rows.items():
        tokenized=[item for r in group if (item:=tokenize(r)) is not None]
        count=min(sum(x['language']==lang for x in tokenized) for lang in ['zh','en'])
        sets[split]=[x for x in tokenized if x['language']=='zh'][:count]+[x for x in tokenized if x['language']=='en'][:count]
        random.shuffle(sets[split])
    def collate(items):
        length=max(len(x['input_ids']) for x in items)
        return {key:torch.tensor([item[key]+([tokenizer.pad_token_id if key=='input_ids' else -100]*(length-len(item[key]))) for item in items],device=device) for key in ['input_ids','labels']} | {
            'attention_mask':torch.tensor([[1]*len(item['input_ids'])+[0]*(length-len(item['input_ids'])) for item in items],device=device)}
    def evaluate(items):
        model.eval(); losses=[]
        with torch.no_grad():
            for item in items:
                batch=collate([item]); loss=model(**batch).loss
                losses.append(float(loss))
        return sum(losses)/len(losses)
    if min(map(len,sets.values()))<10: raise RuntimeError('Not enough tokenized examples after length filtering')
    baseline=evaluate(sets['validation'][:40]); print(json.dumps({'stage':'baseline','validation_loss':baseline,'examples':{s:len(v) for s,v in sets.items()},'device':device}),flush=True)
    loader=DataLoader(sets['train'],batch_size=args.batch_size,shuffle=True,collate_fn=collate,num_workers=0)
    optimizer=torch.optim.AdamW([p for p in model.parameters() if p.requires_grad],lr=1e-4,weight_decay=.01)
    step=0; history=[]; optimizer.zero_grad(); model.train()
    while step<args.steps:
        for batch in loader:
            loss=model(**batch).loss
            if not torch.isfinite(loss): raise RuntimeError('Non-finite loss; training stopped')
            (loss/args.accumulation).backward(); step+=1
            if step%args.accumulation==0 or step==args.steps:
                torch.nn.utils.clip_grad_norm_(model.parameters(),1.0); optimizer.step(); optimizer.zero_grad()
            if step%10==0:
                log={'step':step,'loss':round(float(loss.detach()),4),'seconds':round(time.time()-started,1)}
                history.append(log); print(json.dumps(log),flush=True)
            if step>=args.steps: break
    validation=evaluate(sets['validation'][:40]); test=evaluate(sets['test'][:40])
    with model.disable_adapter(): baseline_test=evaluate(sets['test'][:40])
    target=ROOT/'models/local/generator-adapter'; target.mkdir(parents=True,exist_ok=True)
    model.save_pretrained(target,safe_serialization=True); tokenizer.save_pretrained(target)
    report={'base_model':base,'revision':revision,'seed':42,'backend':device,'gpu':torch.cuda.get_device_name(0),
      'trainable_parameters':sum(p.numel() for p in model.parameters() if p.requires_grad),
      'total_parameters':sum(p.numel() for p in model.parameters()),'micro_steps':step,'optimizer_steps':math.ceil(step/args.accumulation),
      'examples':{s:len(v) for s,v in sets.items()},'selected_languages':{s:dict(collections.Counter(r['language'] for r in v)) for s,v in rows.items()},
      'tokenized_languages':{s:dict(collections.Counter(r['language'] for r in v)) for s,v in sets.items()},
      'loss_evaluation_examples':{'validation':min(40,len(sets['validation'])),'test':min(40,len(sets['test']))},
      'max_length':args.length,'baseline_validation_loss':baseline,'adapter_validation_loss':validation,'test_loss':test,'baseline_test_loss':baseline_test,
      'training_loss':history,'peak_cuda_gb':torch.cuda.max_memory_allocated()/1024**3,'elapsed_seconds':time.time()-started,
      'corpus_sha256':digest((DATA/'processed/corpus.jsonl').read_bytes()),
      'limitations':['Small local adaptation, not a clinical or safety model.','No test-set parameter tuning.','Loss alone does not establish better empathy.','Classifier and generator are separate models.']}
    write_json(DATA/'reports/generator.json',report)
    print(json.dumps(report,ensure_ascii=False,indent=2),flush=True)

if __name__=='__main__': main()
