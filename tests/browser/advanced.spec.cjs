const {test,expect}=require('@playwright/test');
test('experiment planning, negative outcome, review and iteration persist across reload and deletion',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.locator('#openExperiments').click();
 await page.locator('#experimentTitleInput').fill('午休散步实验');
 await page.getByLabel('想验证的假设',{exact:true}).fill('散步可能缓解下午的困倦');await page.getByLabel('具体尝试',{exact:true}).fill('午饭后散步十分钟');await page.getByLabel('如何观察结果',{exact:true}).fill('连续三天记录困倦程度');
 await page.getByRole('button',{name:'开始尝试',exact:true}).click();await expect(page.locator('#experimentState')).toContainText('尝试中');
 await page.getByLabel('实际结果',{exact:true}).fill('三天都没有改善');await page.getByRole('button',{name:'记录完成',exact:true}).click();await expect(page.locator('#experimentState')).toContainText('等待复盘');
 await page.getByLabel('复盘收获',{exact:true}).fill('目前不支持这个假设');await page.getByLabel('下一轮调整',{exact:true}).fill('改为提前半小时睡觉');await page.getByRole('button',{name:'完成复盘',exact:true}).click();await expect(page.locator('#experimentState')).toContainText('已复盘');
 const id=await page.locator('#experimentTask').inputValue();await page.reload();await page.locator('#openExperiments').click();await page.locator('#experimentTask').selectOption(id);await expect(page.getByLabel('实际结果',{exact:true})).toHaveValue('三天都没有改善');
 await page.getByRole('button',{name:'按调整开始下一轮',exact:true}).click();await expect(page.locator('#experimentState')).toContainText('第 2 轮');await expect(page.getByLabel('具体尝试',{exact:true})).toHaveValue('改为提前半小时睡觉');await expect(page.getByLabel('实际结果',{exact:true})).toHaveValue('');
 await page.locator('#experimentDialog').evaluate(el=>{el.scrollTop=0;});await page.screenshot({path:`artifacts/${info.project.name}-experiments.png`,fullPage:true});expect(await page.locator('#experimentDialog').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await page.locator('#closeExperiments').click();await page.locator('#openMemory').click();await page.locator('.memory-entry').filter({hasText:'午休散步实验'}).getByRole('button',{name:'删除',exact:true}).click();await expect(page.locator('#continuityView')).not.toContainText('午休散步实验');expect(errors).toEqual([]);
});
test('session health offers continuing, closing and a new conversation while keeping memory',async({page})=>{
 await page.route('**/api/session',async route=>{const response=await route.fetch();const data=await response.json();if(route.request().method()==='GET' && data.turnCount>0 && data.state!=='SESSION_CLOSE')data.health={status:'duration_limit',message:'已经聊了一段时间，可以休息或继续。'};await route.fulfill({response,json:data});});
 await page.goto('/');await page.locator('#userInput').fill('我正在写论文');await page.locator('#sendButton').click();await expect(page.locator('#userInput')).toBeEnabled();await page.reload();await expect(page.locator('#sessionHealth')).toBeVisible();
 await page.locator('#healthClose').click();await expect(page.locator('#sessionHealth')).toContainText('告一段落');await expect(page.locator('#healthContinue')).toBeVisible();
 await page.locator('#healthNew').click();await expect(page.locator('#sessionHealth')).toBeHidden();await expect(page.locator('#memoryCount')).toHaveText('1');await expect(page.locator('#welcome')).toBeVisible();
});
test('classifier maintenance displays measured scope and sends only fixed training or rollback operations',async({page})=>{
 const operations=[];const state={status:'success',phase:'idle',scheduleHours:0,nextRunAt:null,model:{activeVersion:'a'.repeat(32),canRollback:true,candidate:{version:'a'.repeat(32),passed:true,reasons:[],scope:['validation/en/human'],evaluations:{'validation/en/human':{examples:100,macro_f1:.45}},baseline:{'validation/en/human':{examples:100,macro_f1:.44}}}}};
 await page.route('**/api/corpus',async route=>{if(route.request().method()==='POST')operations.push(route.request().postDataJSON());await route.fulfill({json:state});});
 await page.goto('/');await page.locator('#openCorpus').click();await expect(page.locator('#classifierMetrics')).toContainText('100 条');await expect(page.locator('#classifierStatus')).toContainText('通过固定评估门槛');
 await page.locator('#retrainModel').click();await expect(page.locator('#retrainModel')).toBeEnabled();await page.locator('#rollbackModel').click();await expect(page.locator('#rollbackModel')).toBeEnabled();expect(operations).toEqual([{action:'retrain'},{action:'rollback'}]);
});
