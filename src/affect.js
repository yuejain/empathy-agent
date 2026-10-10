'use strict';
let affectBusy=false,affectRevision=0;
const affectDimensions={valence:'情绪基调',arousal:'活跃程度',warmth:'温暖倾向',concern:'关切倾向',curiosity:'探索兴趣'};
function renderAffect(view){
  if(!view)return;
  $('affectEnabled').checked=view.enabled;$('affectTone').textContent=view.tone;
  $('affectPersistence').textContent=!view.enabled?'已关闭，不调节回复。':view.persistence==='cross-session'?`跨会话延续 · 已参与 ${view.turns} 轮交流`:'仅本轮生效：自动记忆或召回已关闭，不保存跨会话状态。';
  const dimensions=$('affectDimensions');dimensions.replaceChildren();
  for(const [key,label] of Object.entries(affectDimensions)){
    const row=document.createElement('div');row.className='affect-dimension';
    const heading=document.createElement('span');heading.textContent=label;row.append(heading);
    for(const [which,title] of [['feeling','当下'],['mood','心境']]){
      const wrap=document.createElement('label');wrap.textContent=title;const meter=document.createElement('meter');
      meter.min=key==='valence'?-1:0;meter.max=1;meter.value=view[which][key];meter.setAttribute('aria-label',label+' · '+title);wrap.append(meter);row.append(wrap);
    }dimensions.append(row);
  }
  const events=$('affectEvents');events.replaceChildren();
  for(const event of view.events){const item=document.createElement('li');item.textContent=`${event.label} · ${event.source==='merged'?'结合上下文理解':'本地事件规则'}`;events.append(item);}
  if(!view.events.length){const item=document.createElement('li');item.textContent='没有新的明确事件，状态自然趋于平稳。';events.append(item);}
}
async function affectOperation(change){
  if(affectBusy || controller)return;affectBusy=true;
  $('affectDialog').querySelectorAll('button,input').forEach(e=>{if(e.id!=='closeAffect')e.disabled=true;});$('affectError').hidden=true;
  try{
    const data=await(await api('/api/memories',change?{method:'POST',body:JSON.stringify({revision:affectRevision,action:'affect',affect:change})}:undefined)).json();
    affectRevision=data.revision;memoryData=data;renderMemory();
  }catch(error){$('affectError').textContent=error.message;$('affectError').hidden=false;}
  finally{affectBusy=false;$('affectDialog').querySelectorAll('button,input').forEach(e=>{e.disabled=false;});}
}
document.getElementById('openAffect').addEventListener('click',()=>{document.getElementById('affectDialog').showModal();affectOperation();});
document.getElementById('closeAffect').addEventListener('click',()=>document.getElementById('affectDialog').close());
document.getElementById('affectEnabled').addEventListener('change',event=>affectOperation({enabled:event.target.checked}));
document.getElementById('resetAffect').addEventListener('click',()=>affectOperation({reset:true}));
document.getElementById('refreshAffect').addEventListener('click',()=>affectOperation());
