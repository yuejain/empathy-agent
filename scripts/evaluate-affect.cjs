// Offline deterministic replay of synthetic cases; never reads .env, stored sessions,
// or a provider. Passing this suite validates control policy, not human-rated expression.
const assert=require('node:assert/strict');
const {emptyProfile,mutateMemory,profileSchema}=require('../dist/lib/memory');
const {advanceAffect,affectView,affectPrompt,baseline}=require('../dist/lib/affect/engine');
const fixture=require('../tests/fixtures/affect-replay.cjs');
const START=Date.UTC(2026,9,18,8);

function runReplay(dataset=fixture){
 const results=[];
 for(const scenario of dataset.cases){
  let profile=emptyProfile('synthetic-affect-owner'),now=START,checks=0,turns=0;
  if(scenario.settings)profile.settings={...scenario.settings};
  const trajectory=[];
  const check=(condition,message)=>{checks++;assert.ok(condition,message);};
  const equal=(actual,expected,message)=>{checks++;assert.deepEqual(actual,expected,message);};
  try{
   for(const step of scenario.steps){
    now+=(step.waitHours||0)*3600000;
    const origin={sessionId:'synthetic-replay-session',turnId:String(turns),now};
    if(step.reset || step.enabled!==undefined)profile=mutateMemory(profile,{revision:profile.revision,action:'affect',affect:{...(step.reset?{reset:true}:{}),...(step.enabled!==undefined?{enabled:step.enabled}:{})}},origin);
    if(step.restart)profile=JSON.parse(JSON.stringify(profile));
    let view=affectView(profile,now);
    for(let i=0;step.input!==undefined && i<(step.repeat||1);i++){
     now+=60000;turns++;view=advanceAffect(profile,step.input,step.appraisals||[],now);
     check(profileSchema.safeParse(profile).success,'persisted state must satisfy its bounded schema');
     check(view.events.length<=3,'event count must stay bounded');
     if(!profile.settings.capture || !profile.settings.recall || profile.affect?.enabled===false)equal(profile.affect?.state,undefined,'privacy and disabling must prevent persistence');
     if(profile.affect?.state)check(!/quote|sessionId|turnId|报告|report|难过|anxious/.test(JSON.stringify(profile.affect.state)),'state must contain no source text or identifiers');
    }
    const expected=step.expect||{},prompt=affectPrompt(view);
    for(const key of ['mode','pace','warmth','followUp','basis'])if(expected[key]!==undefined)equal(view.delivery[key],expected[key],key);
    for(const key of ['tone','turns','persistence'])if(expected[key]!==undefined)equal(view[key],expected[key],key);
    if(expected.persisted!==undefined)equal(!!profile.affect?.state,expected.persisted,'persisted');
    if(expected.events)equal(view.events.map(e=>e.signal),expected.events,'events');
    if(expected.hasEvent)check(view.events.some(e=>e.signal===expected.hasEvent),'required event');
    if(expected.noEvent)check(!view.events.some(e=>e.signal===expected.noEvent),'contradictory event');
    if(expected.concernAbove!==undefined)check(view.feeling.concern>expected.concernAbove,'current event must override residual concern');
    if(expected.moodConcernAbove!==undefined)check(view.mood.concern>expected.moodConcernAbove,'slow mood must retain bounded continuity');
    if(expected.nearFastBaseline || expected.nearBaseline)for(const key of Object.keys(baseline))check(Math.abs(view.feeling[key]-baseline[key])<.001,`fast recovery ${key}`);
    if(expected.nearBaseline)for(const key of Object.keys(baseline))check(Math.abs(view.mood[key]-baseline[key])<.001,`slow recovery ${key}`);
    if(!view.enabled)equal(prompt,'','disabled affect must not supply a prompt');
    else{
     check(prompt.includes('不是已证实的主观体验'),'simulation boundary');
     check(prompt.includes('不制造内疚、依赖'),'dependency guard');
     check(prompt.includes('事实必须来自当前原话或有效历史'),'no fabricated facts');
     if(view.delivery.followUp==='none')check(prompt.includes('本轮不追问'),'boundary must reach model instructions');
     if(view.delivery.basis==='state' && view.delivery.mode==='support')check(prompt.includes('不推断用户仍在困难中'),'inertia must not become current facts');
    }
    trajectory.push({turn:turns,mode:view.delivery.mode,pace:view.delivery.pace,warmth:view.delivery.warmth,basis:view.delivery.basis,
     feeling:view.feeling,mood:view.mood,events:view.events.map(e=>e.signal),persistence:view.persistence});
   }
   results.push({id:scenario.id,passed:true,checks,turns,trajectory});
  }catch(error){results.push({id:scenario.id,passed:false,checks,turns,error:error.message,trajectory});}
 }
 return {schemaVersion:1,dataset:dataset.id,provenance:dataset.provenance,
  scope:'Deterministic state and prompt-policy regression only; not human-rated dialogue, clinical validity, cloud compliance or subjective experience.',
  cases:results.length,passed:results.filter(r=>r.passed).length,checks:results.reduce((s,r)=>s+r.checks,0),turns:results.reduce((s,r)=>s+r.turns,0),results};
}
module.exports={runReplay};
if(require.main===module){
 const args=process.argv.slice(2);
 if(args.length && !(args.length===2 && args[0]==='--output'))throw Error('Usage: node scripts/evaluate-affect.cjs [--output report.json]');
 const report=runReplay(),json=JSON.stringify(report,null,2)+'\n';
 if(args.length){const fs=require('node:fs'),path=require('node:path');fs.mkdirSync(path.dirname(args[1]),{recursive:true});fs.writeFileSync(args[1],json);process.stdout.write(JSON.stringify({dataset:report.dataset,provenance:report.provenance,cases:report.cases,passed:report.passed,turns:report.turns,checks:report.checks,output:args[1]})+'\n');}
 else process.stdout.write(json);
 if(report.passed!==report.cases)process.exitCode=1;
}
