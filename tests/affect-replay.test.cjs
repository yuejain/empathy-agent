const {test}=require('node:test');
const assert=require('node:assert/strict');
const {emptyProfile}=require('../dist/lib/memory');
const {advanceAffect,affectView,affectPrompt,baseline}=require('../dist/lib/affect/engine');
const {runReplay}=require('../scripts/evaluate-affect.cjs');
const fixture=require('./fixtures/affect-replay.cjs');
const NOW=Date.UTC(2026,9,18,8);

test('synthetic bilingual multi-turn affect replay is deterministic and passes every scenario',()=>{
 const report=runReplay();assert.equal(report.provenance,'synthetic-agent-authored');
 assert.equal(report.passed,fixture.cases.length,JSON.stringify(report.results.filter(r=>!r.passed),null,2));
 assert.ok(report.turns>200);assert.deepEqual(runReplay(),report);
});

test('identical fast state with different slow moods changes delivery instructions without asserting user facts',()=>{
 const p=emptyProfile('synthetic'),fast={...baseline,arousal:.38,valence:.40};
 const state={epoch:0,updatedAt:NOW,turns:10,events:[],feeling:fast,mood:{...baseline}};
 const calm=affectView(p,NOW,state);
 const concerned=affectView(p,NOW,{...state,mood:{...baseline,concern:.55,warmth:.72}});
 const lively=affectView(p,NOW,{...state,mood:{...baseline,arousal:.40,valence:.40}});
 assert.equal(calm.tone,concerned.tone);assert.equal(calm.tone,lively.tone);
 assert.equal(calm.delivery.pace,'steady');assert.equal(concerned.delivery.pace,'unhurried');assert.equal(lively.delivery.pace,'light');
 assert.equal(concerned.delivery.warmth,'warm');
 assert.match(affectPrompt(concerned),/节奏放缓/);assert.match(affectPrompt(lively),/稍轻快/);
 for(const view of [calm,concerned,lively]){assert.match(affectPrompt(view),/惯性中的欣慰不是新的成功证据/);assert.match(affectPrompt(view),/事实必须来自当前原话或有效历史/);}
});

test('explicit negative result overrides warm positive inertia before numeric state crosses concern threshold',()=>{
 const p=emptyProfile('synthetic');
 for(let i=0;i<20;i++)advanceAffect(p,'我完成了报告',[],NOW+i);
 const view=advanceAffect(p,'没有改善。我发现还能再观察',[],NOW+100);
 assert.ok(view.feeling.valence>0);assert.ok(view.feeling.concern<.32);
 assert.equal(view.delivery.mode,'support');assert.equal(view.tone,'关切');assert.equal(view.delivery.pace,'unhurried');
 assert.match(affectPrompt(view),/不用旧进展或乐观心境冲淡/);
});

test('question clauses cannot yield a factual prefix while a separate factual clause and polite boundary remain usable',()=>{
 for(const input of ['I finished the task?','我完成了报告吗？']){
  const view=advanceAffect(emptyProfile('synthetic'),input,[],NOW);assert.deepEqual(view.events,[]);
 }
 const statement=advanceAffect(emptyProfile('synthetic'),'I finished the task. How can I rest?',[],NOW);
 assert.equal(statement.delivery.mode,'encourage');
 const boundary=advanceAffect(emptyProfile('synthetic'),'不要建议，好吗？',[],NOW);
 assert.equal(boundary.delivery.mode,'space');assert.equal(boundary.delivery.followUp,'none');
});

test('a current boundary or correction overrides any slow mood without changing stored schema',()=>{
 for(const signal of ['boundary','correction'])for(const mood of [{...baseline,arousal:1,warmth:1,valence:1},{...baseline,concern:1,valence:-1}]){
  const p=emptyProfile('synthetic'),state={epoch:0,updatedAt:NOW,turns:3,events:[{signal,source:'local',confidence:.8}],feeling:{...baseline},mood};
  const view=affectView(p,NOW,state);assert.equal(view.delivery.followUp,'none');assert.equal(view.delivery.warmth,'gentle');
  assert.equal(view.delivery.mode,signal==='boundary'?'space':'repair');assert.match(affectPrompt(view),/本轮不追问/);
  assert.equal(p.affect,undefined);
 }
});
