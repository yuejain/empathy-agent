'use strict';
const progressNames = { planned:'考虑 / 计划中',in_progress:'进行中',blocked:'遇到阻碍',completed:'已完成',cancelled:'已撤回' };
function renderContinuity(view) {
  const root=$('continuityView');root.replaceChildren();
  if (!view) return;
  const stage=document.createElement('p');stage.className='memory-hint';stage.textContent=`接下来可以：${({journey_stage_1:'先说说感受，慢慢安定下来',journey_stage_2:'把眼前的事情梳理清楚',journey_stage_3:'回顾尝试，看看有什么收获',journey_stage_4:'整理收获，选择接下来的方向'})[view.journey.stage] || '按自己的节奏继续聊'}`;root.appendChild(stage);
  const title=document.createElement('h3');title.textContent='行动与决策';root.appendChild(title);
  const list=document.createElement('ul');list.className='follow-up-list';
  for(const item of view.tasks.slice(0,6)) {
    const row=document.createElement('li');row.textContent=`${item.label} · ${item.text}${item.dueAt ? `（目标日期 ${new Date(item.dueAt).toLocaleDateString()}）` : ''}`;
    list.appendChild(row);
  }
  if(!view.tasks.length){const row=document.createElement('li');row.textContent='还没有可跟进的事项。';list.appendChild(row);}root.appendChild(list);
  const trend=document.createElement('h3');trend.textContent='跨会话情绪记录 · 近 30 天';root.appendChild(trend);
  const summary=document.createElement('p');summary.textContent=`${view.trend.label}（${view.trend.observations} 条记录）`;root.appendChild(summary);
  const timeline=document.createElement('ol');timeline.className='emotion-timeline';timeline.setAttribute('aria-label','有日期的情绪记录');
  for(const point of view.trend.points.slice(-8)) {
    const row=document.createElement('li');row.textContent=`${new Date(point.at).toLocaleDateString()} · ${point.emotion}${point.inferred ? '（推测，不参与趋势判断）' : ''}`;
    timeline.appendChild(row);
  }
  root.appendChild(timeline);const note=document.createElement('p');note.className='memory-hint';note.textContent=view.trend.note;root.appendChild(note);
  if(view.reflectionHistory?.length){const title=document.createElement('h3');title.textContent='联想练习中，你自己提到的事';root.appendChild(title);for(const item of view.reflectionHistory){const p=document.createElement('p');p.textContent=`${new Date(item.reportedAt).toLocaleDateString()} · ${item.statement}`;root.appendChild(p);}}
}
function renderReflection(value) {
  const root=$('reflectionChoices');root.replaceChildren();root.hidden=!value || value.dismissed || value.selected!==undefined;
  if(root.hidden)return;
  for(const [i,text] of value.options.entries()) {
    const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent=`选 ${'ABC'[i]}`;button.title=text;
    button.addEventListener('click',()=>{$('userInput').value='我选'+'ABC'[i];sendMessage();});root.appendChild(button);
  }
  const skip=document.createElement('button');skip.type='button';skip.className='text-button';skip.textContent='跳过';skip.addEventListener('click',()=>{$('userInput').value='跳过';sendMessage();});root.appendChild(skip);
}
