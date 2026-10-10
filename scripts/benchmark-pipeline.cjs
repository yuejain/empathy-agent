// Synthetic fixtures only. --cloud explicitly sends synthetic messages to the configured provider.
const fs=require('node:fs');const assert=require('node:assert/strict');
const {LocalKnowledge}=require('../dist/lib/local-knowledge');
const {ConversationOrchestrator}=require('../dist/lib/orchestrator');
const {emptyProfile,prepareMemory}=require('../dist/lib/memory');
const summarize=values=>{const sorted=[...values].sort((a,b)=>a-b);return {samples:values.length,p50Ms:+sorted[Math.floor(sorted.length*.5)].toFixed(2),p95Ms:+sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))].toFixed(2)};};
async function main(){
 const local=new LocalKnowledge(process.env);assert.ok((await local.health()).available,'Start local RAG first');
 const report={at:new Date().toISOString(),node:process.version,local:[],cloud:[]};
 for(const count of [0,20,80]){
  const memories=Array.from({length:count},(_,i)=>({id:crypto.randomUUID(),text:`I am working on research project ${i} and preparing my thesis presentation.`}));
  const values=[],encoding=[];
  for(let n=0;n<6;n++){
   const start=performance.now(),result=await local.analyze('I feel worried about my thesis presentation.',undefined,{query:'I feel worried about my thesis presentation.',memories});
   assert.equal(result?.memory_hits?.length,count,'Joint retrieval response missing');
   if(n){values.push(performance.now()-start);encoding.push(result.timings.encodeMs);}
  }
  report.local.push({candidates:count,...summarize(values),encode:summarize(encoding)});
 }
 const protocol=[];for(let n=0;n<10;n++){const start=performance.now();await local.health();protocol.push(performance.now()-start);}report.localHealth=summarize(protocol);
 if(process.argv.includes('--cloud')){
  const o=new ConversationOrchestrator(process.env);let profile=emptyProfile('benchmark-owner');
  profile=prepareMemory(profile,'我正在写论文。我计划练习演讲。我很焦虑。直接一点',{sessionId:'benchmark-seed',turnId:'1',now:Date.now()}).profile;
  for(const [i,message] of ['那论文还是没有思路，今天只想倾诉，不用建议。','How is my research document coming along? Please listen, no advice.'].entries()){
   const start=performance.now();let firstDeltaMs;
   const result=await o.processTurn({userId:profile.owner,sessionId:`benchmark-${i}`,userInput:message,memoryProfile:profile,onDelta:()=>{firstDeltaMs??=performance.now()-start;}});
   assert.equal(result.metadata.backend,'cloud');assert.equal(result.metadata.retrieval.mode,'semantic-hybrid');assert.ok(result.metadata.memoryUsed>0);
   assert.equal(result.metadata.rag.direction.mode,'listen');assert.ok(firstDeltaMs);
   report.cloud.push({language:i?'en':'zh',firstDeltaMs:Math.round(firstDeltaMs),totalMs:Math.round(performance.now()-start),timings:result.metadata.timings,retrieval:result.metadata.retrieval,taskCount:result.metadata.continuity.tasks.length});
  }
 }
 fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync('artifacts/pipeline-benchmark.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
