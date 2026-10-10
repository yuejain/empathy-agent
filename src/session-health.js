'use strict';
function renderSessionHealth(health) {
  const banner=$('sessionHealth');banner.hidden=!health || ['healthy','not_found','safety_support'].includes(health.status);
  $('sessionHealthText').textContent=health?.message||'';
  $('healthContinue').hidden=false;
  $('healthClose').hidden=health?.status==='closed';
}
async function changeSessionHealth(action) {
  if(controller)return;
  try {const response=await api('/api/session',{method:'POST',body:JSON.stringify({action})});renderSessionHealth((await response.json()).health);await loadSession();}
  catch(error){showError(error.message);}
}
document.getElementById('healthContinue').addEventListener('click',()=>changeSessionHealth('continue'));
document.getElementById('healthClose').addEventListener('click',()=>changeSessionHealth('close'));
document.getElementById('healthNew').addEventListener('click',()=>document.getElementById('newChat').click());
setInterval(async()=>{if(!ready || controller || document.hidden)return;try{renderSessionHealth(await (await api('/api/session/health')).json());}catch{}},60000);
