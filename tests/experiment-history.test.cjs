const {test}=require('node:test');
const assert=require('node:assert/strict');
const {emptyProfile,prepareMemory,mutateMemory,profileSchema}=require('../dist/lib/memory');
const {changeExperiment,currentCycle,experimentSummary,experimentPrompt}=require('../dist/lib/memory/experiments');
const {continuityView}=require('../dist/lib/context/continuity');
const NOW=Date.UTC(2026,9,18,8);
const origin=turn=>({sessionId:'synthetic-experiment-session',turnId:String(turn),now:NOW+turn*1000});
const plan={hypothesis:'午休散步可能改善下午精神',plan:'午饭后走十分钟',measure:'记录下午困倦程度'};
function fixture(){return prepareMemory(emptyProfile('synthetic-owner'),'我正在尝试午休散步',origin(0)).profile;}
function twoRounds(){
 const p=fixture(),entry=p.entries[0];
 changeExperiment(entry,{operation:'review',fields:{...plan,result:'连续三天没有改善',learning:'目前没有支持假设的证据',adjustment:'改为午饭后走五分钟'}},origin(1),'user');
 changeExperiment(entry,{operation:'iterate'},origin(2));
 changeExperiment(entry,{operation:'complete',fields:{result:'这两天下午更困了'}},origin(3),'user');
 return {p,entry};
}
const payload=prompt=>JSON.parse(prompt.slice(prompt.lastIndexOf('\n')+1));

test('multi-round review retains exact attempts, negative outcomes and inherited source field identity',()=>{
 const {entry}=twoRounds(),summary=experimentSummary(entry),[first,second]=summary.rounds;
 assert.equal(summary.cycle,2);assert.deepEqual(summary.fields,second.fields);assert.equal(summary.status,'awaiting_review');
 assert.equal(first.fields.result,'连续三天没有改善');assert.equal(second.fields.result,'这两天下午更困了');
 assert.equal(second.fields.plan,first.fields.adjustment);
 assert.equal(second.sources.plan.fieldId,`${entry.id}/${second.cycleId}/plan`);
 assert.equal(second.sources.plan.sourceId,first.sources.adjustment.fieldId);
 assert.equal(second.sources.plan.version,first.sources.adjustment.version);
 assert.equal(second.sources.plan.turnId,'1');assert.equal(second.sources.result.turnId,'3');
 assert.notEqual(second.sources.result.version,first.sources.result.version);
 const prompt=experimentPrompt([summary]);assert.ok(prompt.length<=2600);const out=payload(prompt).experiments[0];
 assert.deepEqual(out.rounds.map(r=>r.cycle),[1,2]);
 assert.equal(out.rounds[0].fields.result.quote,first.fields.result);
 assert.equal(out.rounds[1].fields.result.quote,second.fields.result);
 assert.deepEqual(out.rounds[1].fields.plan.from,{cycleId:first.cycleId,field:'adjustment'});
 assert.equal(out.rounds[1].fields.result.version,second.sources.result.version);
 assert.match(prompt,/区分已尝试与下一轮计划/);assert.match(prompt,/完成不代表有效/);
});

test('correction changes evidence version without changing field location; deletion cannot resurrect current evidence',()=>{
 const {entry}=twoRounds(),before=experimentSummary(entry),old=before.sources.result;
 changeExperiment(entry,{operation:'save',fields:{result:'更正：这两天状态没有变化'}},origin(4),'user');
 const corrected=experimentSummary(entry);
 assert.equal(corrected.sources.result.fieldId,old.fieldId);assert.notEqual(corrected.sources.result.version,old.version);
 assert.equal(corrected.sources.result.turnId,'4');assert.doesNotMatch(experimentPrompt([corrected],12000),/这两天下午更困了/);
 changeExperiment(entry,{operation:'save',fields:{result:null,plan:null}},origin(5));
 const deleted=experimentSummary(entry),out=payload(experimentPrompt([deleted],12000)).experiments[0].rounds.at(-1);
 assert.equal(deleted.fields.result,undefined);assert.equal(deleted.sources.result,undefined);
 assert.equal(out.fields.result,undefined);assert.equal(out.fields.plan,undefined);
 assert.doesNotMatch(JSON.stringify(deleted),/更正：这两天状态没有变化/);
 // Historical observations remain historical, never fill a deleted current result.
 assert.equal(deleted.rounds[0].fields.result,'连续三天没有改善');
 delete entry.experiment.cycles[0].result;
 assert.doesNotMatch(experimentPrompt([experimentSummary(entry)],12000),/连续三天没有改善/);
 changeExperiment(entry,{operation:'remove'},origin(6));assert.equal(experimentSummary(entry),undefined);
});

test('reported identical text is distinct from inherited evidence and survives serialization without cached provenance',()=>{
 const {entry}=twoRounds(),original=experimentSummary(entry);
 changeExperiment(entry,{operation:'save',fields:{plan:'这次采用另一种观察'}},origin(4),'user');
 changeExperiment(entry,{operation:'save',fields:{plan:original.fields.plan}},origin(5),'user');
 const summary=experimentSummary(JSON.parse(JSON.stringify(entry)));
 assert.equal(summary.sources.plan.sourceId,summary.sources.plan.fieldId);
 assert.notEqual(summary.sources.plan.version,original.sources.plan.version);
 assert.equal(summary.sources.plan.turnId,'5');
 assert.deepEqual(experimentSummary(entry),summary);assert.equal(profileSchema.shape.entries.element.safeParse(entry).success,true);
});

test('prompt budgets include every character, retain full quotes or omit them, and identify missing history',()=>{
 const {entry}=twoRounds();
 entry.text='我在记录这次午休散步的整个过程。'.repeat(16)+'但我并没有决定继续。';
 const longResult='我逐项记录了本轮经过。'.repeat(32)+'前面的好转只是猜测，实际没有改善。';
 changeExperiment(entry,{operation:'save',fields:{result:longResult,learning:'需要更多观察。'.repeat(50)}},origin(4),'user');
 const summary=experimentSummary(entry);
 for(const budget of [0,1,200,500,800,1200,1800,2600,5000,12000,NaN,Infinity,-1]){
  const text=experimentPrompt([summary],budget),limit=Number.isFinite(budget)?Math.max(0,Math.floor(budget)):0;
  assert.ok(text.length<=limit,`budget ${budget}: ${text.length}`);if(!text)continue;
  const result=payload(text).experiments[0],round=result.rounds.find(r=>r.cycle===2);assert.equal(result.title,entry.text);
  if(round.fields.result)assert.equal(round.fields.result.quote,longResult);
  else assert.ok(round.omittedFields.includes('result'));
  for(const r of result.rounds)for(const [field,evidence] of Object.entries(r.fields))assert.equal(evidence.quote,summary.rounds[r.cycle-1].fields[field]);
 }
 const full=experimentPrompt([summary],12000);assert.match(full,/实际没有改善/);
 assert.equal(experimentPrompt([],2600),'');
 const max=experimentPrompt(Array.from({length:5},()=>summary),12000);assert.equal(payload(max).experiments.length,3);assert.equal(payload(max).omittedExperiments,2);
});

test('eight-round summaries are bounded and budgeted; recall-off and record deletion remove all round references',()=>{
 let p=fixture(),entry=p.entries[0];
 for(let i=1;i<=8;i++){
  changeExperiment(entry,{operation:'review',fields:{...plan,result:`第${i}轮仍没有明显改善`,learning:'不确定，需要再观察',adjustment:`第${i+1}轮缩短尝试时间`}},origin(i*2),'user');
  if(i<8)changeExperiment(entry,{operation:'iterate'},origin(i*2+1));
 }
 const summary=experimentSummary(entry);assert.equal(summary.rounds.length,8);
 const text=experimentPrompt([summary]),out=payload(text).experiments[0];assert.ok(text.length<=2600);
 assert.ok(out.rounds.some(r=>r.cycle===8));assert.ok(out.omittedCycles>0);
 assert.equal(out.omittedCycles,8-out.rounds.length);
 assert.throws(()=>changeExperiment(entry,{operation:'iterate'},origin(20)),/8 轮/);
 p=mutateMemory(p,{revision:p.revision,action:'settings',recall:false},origin(21));assert.deepEqual(continuityView(p,NOW).experiments,[]);
 p=mutateMemory(p,{revision:p.revision,action:'delete',id:entry.id},origin(22));assert.doesNotMatch(JSON.stringify(p),/缩短尝试|仍没有明显改善/);
});
