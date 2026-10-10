// Live smoke with a synthetic, in-memory profile only; never reads stored conversations.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {ConversationOrchestrator}=require('../dist/lib/orchestrator');
const {emptyProfile,mutateMemory}=require('../dist/lib/memory');
async function main(){
 if(!process.argv.includes('--cloud'))throw Error('Pass --cloud to send synthetic inputs to the configured provider.');
 const userId='advanced-verification',origin={sessionId:'fixture',turnId:'manual',now:Date.now()};
 let profile=emptyProfile(userId);
 profile=mutateMemory(profile,{revision:profile.revision,action:'add',kind:'activity',text:'我正在进行午休散步实验'},origin);
 const id=profile.entries[0].id;
 profile=mutateMemory(profile,{revision:profile.revision,action:'experiment',id,experiment:{operation:'start',fields:{hypothesis:'午休散步可能减少下午困倦',plan:'午饭后散步十分钟',measure:'连续三天记录下午是否困倦'}}},origin);
 const o=new ConversationOrchestrator(process.env);let deltas=0;
 const result=await o.processTurn({userId,sessionId:'fixture-live',memoryProfile:profile,userInput:'我连续三天午休后都散步十分钟，下午还是一样困。我想复盘这个尝试，目前没有发现改善。',onDelta:()=>{deltas++;}});
 assert.ok(deltas>0);assert.equal(result.metadata.state,'REVIEW_PHASE');assert.equal(result.metadata.intentSource,'merged-context');
 const experiment=result.updatedMemory.entries.find(e=>e.id===id)?.experiment?.cycles.at(-1);assert.ok(experiment,'Original experiment must remain');
 assert.ok(experiment.result,'Real merged analysis must capture user result');
 const cleared=mutateMemory(result.updatedMemory,{revision:result.updatedMemory.revision,action:'clear'},origin);
 const report={at:new Date().toISOString(),deltas,intentSource:result.metadata.intentSource,state:result.metadata.state,experimentResultCaptured:!!experiment.result,clearRemovedAll:cleared.entries.length===0,timings:result.metadata.timings};
 fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync('artifacts/advanced-live.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
