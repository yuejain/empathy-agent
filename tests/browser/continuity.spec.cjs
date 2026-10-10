const {test,expect}=require('@playwright/test');
async function say(page,text){await expect(page.locator('#userInput')).toBeEnabled();await page.locator('#userInput').fill(text);await page.locator('#sendButton').click();await expect(page.locator('#userInput')).toBeEnabled();}
test('task progress, deadline, trend evidence and game choices survive refresh on both layouts',async({page},testInfo)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
 await say(page,'我正在写论文。我现在很焦虑');await page.locator('#openMemory').click();
 const entry=page.locator('.memory-entry').filter({has:page.locator('.memory-text',{hasText:'我正在写论文'})});
 await entry.getByLabel('事项进度').selectOption('blocked');await expect(entry.getByLabel('事项进度')).toBeEnabled();
 await entry.getByLabel('目标日期').fill('2026-12-20');await expect(entry.getByLabel('目标日期')).toBeEnabled();
 await expect(page.locator('#continuityView')).toContainText('遇到阻碍');await expect(page.locator('#continuityView')).toContainText('记录尚不足以判断趋势');
 await page.locator('#memoryDialog').evaluate(el=>{el.scrollTop=0;});
 await page.screenshot({path:`artifacts/${testInfo.project.name}-continuity.png`,fullPage:true});
 expect(await page.locator('#memoryDialog').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await entry.getByLabel('事项进度').selectOption('completed');await expect(page.locator('#continuityView')).toContainText('已完成');
 await page.locator('#closeMemory').click();await page.reload();await page.locator('#openMemory').click();await expect(page.locator('#continuityView')).toContainText('已完成');
 await page.locator('#closeMemory').click();await page.locator('#game').selectOption('scenario');await page.locator('#playGame').click();
 await expect(page.locator('#reflectionChoices')).toBeVisible();await page.reload();await expect(page.locator('#reflectionChoices')).toBeVisible();
 await page.locator('#reflectionChoices').getByRole('button',{name:'选 B',exact:true}).click();await expect(page.locator('.message.assistant').last()).toContainText('你选择了 B');
 await expect(page.locator('#reflectionChoices')).toBeHidden();expect(errors).toEqual([]);
});
test('corpus controls show background status and change the opt-in schedule',async({page})=>{
 let state={status:'idle',phase:'idle',scheduleHours:0,nextRunAt:null};const operations=[];
 await page.route('**/api/corpus',async route=>{if(route.request().method()==='POST'){const op=route.request().postDataJSON();operations.push(op);if(op.action)state={...state,status:'running',phase:'index'};else state={...state,scheduleHours:op.scheduleHours};}await route.fulfill({json:state});});
 await page.goto('/');await page.locator('#openCorpus').click();await expect(page.locator('#corpusStatus')).toContainText('待命');
 await page.locator('#corpusSchedule').selectOption('168');await expect(page.locator('#corpusSchedule')).toBeEnabled();
 await page.locator('#rebuildCorpus').click();await expect(page.locator('#corpusStatus')).toContainText('构建检索索引');
 await expect(page.locator('#updateCorpus')).toBeDisabled();expect(operations).toEqual([{scheduleHours:168},{action:'rebuild'}]);
 await page.locator('#closeCorpus').click();await expect(page.locator('#corpusDialog')).toBeHidden();
});
