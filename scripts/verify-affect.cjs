// Synthetic inputs, independent memory; no private conversations are loaded.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {ConversationOrchestrator}=require('../dist/lib/orchestrator');
const {emptyProfile,mutateMemory}=require('../dist/lib/memory');
async function main(){
 if(!process.argv.includes('--cloud'))throw Error('Pass --cloud to verify with the configured provider.');
 const userId='affect-verification',o=new ConversationOrchestrator(process.env),reports=[];let profile=emptyProfile(userId);
 for(const [index,input] of [
  '我终于完成了准备很久的演讲，虽然还有紧张，但比之前顺利了。我想分享一下这个进展。',
  '我以为散步能缓解压力，连续试了三天却没有改善。现在有点失望，先不用给建议。',
  '你的这些情感变化意味着你真的有主观感受了吗？请区分实现机制与尚未证实的部分。',
 ].entries()){
  console.log('Verifying synthetic affect turn '+(index+1));
  let deltas=0;const result=await o.processTurn({userId,sessionId:'affect-fixture-'+index,userInput:input,memoryProfile:profile,onDelta:()=>{deltas++;}});
  assert.ok(deltas>0);assert.equal(result.metadata.assistantAffect.simulation,true);assert.equal(result.metadata.assistantAffect.turns,index+1);
  profile=result.updatedMemory;reports.push({turn:index+1,deltas,response:result.response,affect:result.metadata.assistantAffect,timings:result.metadata.timings});
  fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync('artifacts/affect-live.json',JSON.stringify({at:new Date().toISOString(),complete:false,turns:reports},null,2));
 }
 const cleared=mutateMemory(profile,{revision:profile.revision,action:'affect',affect:{reset:true}},{sessionId:'fixture',turnId:'reset',now:Date.now()});assert.equal(cleared.affect.state,undefined);
 const report={at:new Date().toISOString(),complete:true,turns:reports,resetClearedState:true};fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync('artifacts/affect-live.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
