'use strict';
const experimentFieldLabels={hypothesis:'想验证的假设',plan:'具体尝试',measure:'如何观察结果',result:'实际结果',learning:'复盘收获',adjustment:'下一轮调整',values:'在意的价值',constraints:'现实限制',direction:'接下来的方向'};
const experimentStatusLabels={draft:'准备中',running:'尝试中',awaiting_review:'等待复盘',reviewed:'已复盘',cancelled:'已撤回'};
let experimentData=null,experimentBusy=false;
function experimentError(message){$('experimentError').textContent=message;$('experimentError').hidden=!message;}
function experimentControls(busy){experimentBusy=busy;$('experimentDialog').querySelectorAll('button,input,select,textarea').forEach(e=>{if(e.id!=='closeExperiments')e.disabled=busy;});}
function selectedExperiment(){return experimentData?.entries.find(e=>e.id===$('experimentTask').value);}
function renderExperimentFields(){
  const entry=selectedExperiment(),cycle=entry?.experiment?.cycles.at(-1);$('experimentNewTitle').hidden=!!entry;
  $('experimentState').textContent=cycle?`第 ${entry.experiment.cycles.length} 轮 · ${experimentStatusLabels[cycle.status]}`:'从一个小尝试开始，不必保证一定有效。';
  for(const field of Object.keys(experimentFieldLabels))$('experiment-'+field).value=cycle?.[field]?.text||'';
  const history=$('experimentHistory');history.replaceChildren();
  for(const [i,past] of (entry?.experiment?.cycles||[]).entries()){
    const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=`第 ${i+1} 轮 · ${experimentStatusLabels[past.status]} · ${new Date(past.updatedAt).toLocaleDateString()}`;details.append(summary);
    for(const [key,label] of Object.entries(experimentFieldLabels))if(past[key]){const text=document.createElement('p');text.textContent=`${label}：${past[key].text}（${new Date(past[key].at).toLocaleDateString()}）`;details.append(text);}history.append(details);
  }
}
async function openExperiments(id){
  $('experimentDialog').showModal();experimentError('');experimentControls(true);
  try{experimentData=await(await api('/api/memories')).json();const select=$('experimentTask');select.replaceChildren();
    const empty=document.createElement('option');empty.value='';empty.textContent='建立新的行动实验';select.append(empty);
    for(const item of experimentData.entries.filter(e=>['activity','decision'].includes(e.kind)&&['active','resolved'].includes(e.status)&&e.expiresAt>Date.now())){const option=document.createElement('option');option.value=item.id;option.textContent=item.text;select.append(option);}
    if(id && [...select.options].some(e=>e.value===id))select.value=id;renderExperimentFields();
  }catch(error){experimentError(error.message);}finally{experimentControls(false);}
}
async function saveExperiment(operation){
  if(experimentBusy || !experimentData)return;experimentControls(true);experimentError('');
  try{
    let entry=selectedExperiment();const fields=Object.fromEntries(Object.keys(experimentFieldLabels).map(k=>[k,$('experiment-'+k).value.trim()||null]));
    if(!entry){const title=$('experimentTitleInput').value.trim();if(!title)throw Error('先给这个尝试起一个名字。');
      const before=new Set(experimentData.entries.map(e=>e.id));experimentData=await(await api('/api/memories',{method:'POST',body:JSON.stringify({revision:experimentData.revision,action:'add',kind:'activity',text:title})})).json();
      entry=experimentData.entries.find(e=>!before.has(e.id))||experimentData.entries.find(e=>e.text===title);if(!entry)throw Error('没有找到新建的事项，请刷新后重试。');
      const option=document.createElement('option');option.value=entry.id;option.textContent=entry.text;$('experimentTask').append(option);$('experimentTask').value=entry.id;
    }
    experimentData=await(await api('/api/memories',{method:'POST',body:JSON.stringify({revision:experimentData.revision,action:'experiment',id:entry.id,experiment:{operation,...(operation==='iterate'?{}:{fields})}})})).json();
    memoryData=experimentData;renderMemory();renderExperimentFields();$('experimentTitleInput').value='';
  }catch(error){experimentError(error.message);}finally{experimentControls(false);}
}
for(const [field,label] of Object.entries(experimentFieldLabels)){
  const wrap=document.createElement('label');wrap.textContent=label;const input=document.createElement('textarea');input.id='experiment-'+field;input.rows=2;input.maxLength=500;input.setAttribute('aria-label',label);wrap.append(input);$('experimentFields').append(wrap);
}
$('openExperiments').addEventListener('click',()=>openExperiments());$('closeExperiments').addEventListener('click',()=>$('experimentDialog').close());
$('experimentTask').addEventListener('change',renderExperimentFields);
$('experimentForm').addEventListener('submit',event=>{event.preventDefault();saveExperiment('save');});
document.querySelectorAll('[data-experiment-action]').forEach(button=>button.addEventListener('click',()=>saveExperiment(button.dataset.experimentAction)));
