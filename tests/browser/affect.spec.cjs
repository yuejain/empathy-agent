const {test,expect}=require('@playwright/test');
test('assistant affect is marked simulated, persists into a new conversation, and can be reset or disabled',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
 await page.locator('#userInput').fill('我完成了演讲');await page.locator('#sendButton').click();await expect(page.locator('#userInput')).toBeEnabled();
 await page.locator('#openAffect').click();await expect(page.locator('#affectTone')).toHaveText('欣慰');await expect(page.locator('#affectPersistence')).toContainText('1 轮');
 await expect(page.locator('#affectDialog')).toContainText('不能据此认定助手拥有主观感受');
 await page.screenshot({path:`artifacts/${info.project.name}-affect.png`,fullPage:true});expect(await page.locator('#affectDialog').evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
 await page.locator('#closeAffect').click();await page.locator('#newChat').click();await page.reload();await page.locator('#openAffect').click();await expect(page.locator('#affectPersistence')).toContainText('1 轮');
 await page.locator('#resetAffect').click();await expect(page.locator('#affectPersistence')).toContainText('0 轮');await expect(page.locator('#affectTone')).toHaveText('平和');
 await page.locator('#affectEnabled').uncheck();await expect(page.locator('#affectTone')).toHaveText('已关闭');await page.reload();await page.locator('#openAffect').click();await expect(page.locator('#affectEnabled')).not.toBeChecked();
 await page.locator('#affectEnabled').check();await expect(page.locator('#affectTone')).toHaveText('平和');expect(errors).toEqual([]);
});
