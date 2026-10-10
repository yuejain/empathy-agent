'use strict';
let corpusTimer=null,corpusBusy=false;
async function corpusOperation(operation) {
  if(corpusBusy)return;corpusBusy=true;$('corpusError').hidden=true;
  $('corpusDialog').querySelectorAll('button,select').forEach(el=>{if(el.id!=='closeCorpus')el.disabled=true;});
  try {
    const state=await(await api('/api/corpus',operation?{method:'POST',body:JSON.stringify(operation)}:{})).json();
    const statuses={idle:'待命',running:'正在更新',success:'更新完成',partial:'部分来源沿用旧快照，或候选模型未通过评估；当前可用版本继续服务',failed:'更新失败，保留上一可用版本',interrupted:'上次更新被中断'};
    const phases={idle:'',queued:'等待执行',collect:'抓取与清洗',index:'构建检索索引',train:'训练与评估候选分类器'};
    $('corpusStatus').textContent=`${statuses[state.status]}${phases[state.phase] ? ' · '+phases[state.phase] : ''}${state.finishedAt ? ' · '+new Date(state.finishedAt).toLocaleString() : ''}${state.nextRunAt ? '；下次 '+new Date(state.nextRunAt*1000).toLocaleString() : ''}`;
    $('corpusSchedule').value=String(state.scheduleHours);
    for(const id of ['updateCorpus','rebuildCorpus','retrainModel'])$(id).dataset.running=String(state.status==='running');
    $('rollbackModel').dataset.running=String(state.status==='running'||!state.model?.canRollback);
    if(state.model){const candidate=state.model.candidate;
      $('classifierStatus').textContent=`当前分类器：${state.model.activeVersion==='legacy'?'初始版本':state.model.activeVersion.slice(0,8)}${candidate?`；最近候选 ${candidate.version.slice(0,8)}：${candidate.passed?'通过固定评估门槛':'未通过，未发布'}`:''}`;
      const list=$('classifierMetrics');list.replaceChildren();
      if(candidate){for(const key of candidate.scope){const row=document.createElement('li'),metric=candidate.evaluations[key],baseline=candidate.baseline[key];row.textContent=`${key} · ${metric.examples} 条 · macro F1 ${metric.macro_f1.toFixed(3)}（原版本 ${baseline.macro_f1.toFixed(3)}）`;list.append(row);}for(const reason of candidate.reasons){const row=document.createElement('li');row.textContent=reason;list.append(row);}}
    }
  } catch(error){$('corpusError').textContent=error.message;$('corpusError').hidden=false;}
  finally {corpusBusy=false;$('corpusDialog').querySelectorAll('button,select').forEach(el=>{el.disabled=el.dataset.running==='true';});}
}
$('openCorpus').addEventListener('click',()=>{$('corpusDialog').showModal();corpusOperation();clearInterval(corpusTimer);corpusTimer=setInterval(()=>corpusOperation(),5000);});
$('closeCorpus').addEventListener('click',()=>$('corpusDialog').close());
$('corpusDialog').addEventListener('close',()=>{clearInterval(corpusTimer);corpusTimer=null;});
$('refreshCorpus').addEventListener('click',()=>corpusOperation());
$('updateCorpus').addEventListener('click',()=>corpusOperation({action:'update'}));
$('rebuildCorpus').addEventListener('click',()=>corpusOperation({action:'rebuild'}));
$('retrainModel').addEventListener('click',()=>corpusOperation({action:'retrain'}));
$('rollbackModel').addEventListener('click',()=>corpusOperation({action:'rollback'}));
$('corpusSchedule').addEventListener('change',()=>corpusOperation({scheduleHours:Number($('corpusSchedule').value)}));
