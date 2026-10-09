'use strict';
let corpusTimer=null,corpusBusy=false;
async function corpusOperation(operation) {
  if(corpusBusy)return;corpusBusy=true;$('corpusError').hidden=true;
  $('corpusDialog').querySelectorAll('button,select').forEach(el=>{if(el.id!=='closeCorpus')el.disabled=true;});
  try {
    const state=await(await api('/api/corpus',operation?{method:'POST',body:JSON.stringify(operation)}:{})).json();
    const statuses={idle:'待命',running:'正在更新',success:'更新完成',partial:'更新完成，部分来源沿用旧快照',failed:'更新失败，保留上一版索引',interrupted:'上次更新被中断'};
    const phases={idle:'',queued:'等待执行',collect:'抓取与清洗',index:'构建检索索引'};
    $('corpusStatus').textContent=`${statuses[state.status]}${phases[state.phase] ? ' · '+phases[state.phase] : ''}${state.finishedAt ? ' · '+new Date(state.finishedAt).toLocaleString() : ''}${state.nextRunAt ? '；下次 '+new Date(state.nextRunAt*1000).toLocaleString() : ''}`;
    $('corpusSchedule').value=String(state.scheduleHours);
    $('updateCorpus').dataset.running=$('rebuildCorpus').dataset.running=String(state.status==='running');
  } catch(error){$('corpusError').textContent=error.message;$('corpusError').hidden=false;}
  finally {corpusBusy=false;$('corpusDialog').querySelectorAll('button,select').forEach(el=>{el.disabled=el.dataset.running==='true';});}
}
$('openCorpus').addEventListener('click',()=>{$('corpusDialog').showModal();corpusOperation();clearInterval(corpusTimer);corpusTimer=setInterval(()=>corpusOperation(),5000);});
$('closeCorpus').addEventListener('click',()=>$('corpusDialog').close());
$('corpusDialog').addEventListener('close',()=>{clearInterval(corpusTimer);corpusTimer=null;});
$('refreshCorpus').addEventListener('click',()=>corpusOperation());
$('updateCorpus').addEventListener('click',()=>corpusOperation({action:'update'}));
$('rebuildCorpus').addEventListener('click',()=>corpusOperation({action:'rebuild'}));
$('corpusSchedule').addEventListener('change',()=>corpusOperation({scheduleHours:Number($('corpusSchedule').value)}));
