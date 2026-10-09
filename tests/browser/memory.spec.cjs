const { test, expect } = require('@playwright/test');

async function say(page, text) {
  await expect(page.locator('#userInput')).toBeEnabled();
  await page.locator('#userInput').fill(text); await page.locator('#sendButton').click();
  await expect(page.locator('#userInput')).toBeEnabled();
}
test('automatic cross-session memory can be inspected, corrected, ended and deleted on desktop and mobile', async ({ page }, testInfo) => {
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  await say(page,'我叫小林。我正在写论文。我很焦虑。我计划考研');
  await page.locator('#newChat').click(); await expect(page.locator('#messages .message')).toHaveCount(0);
  await say(page,'我叫什么'); await expect(page.locator('.message.assistant')).toContainText('小林');
  await page.locator('#openMemory').click(); const dialog=page.getByRole('dialog'); await expect(dialog).toBeVisible();
  await expect(dialog.locator('.memory-entry')).toHaveCount(4);
  await expect(dialog.locator('.memory-entry').filter({hasText:'我计划考研'})).toContainText('考虑中');
  const name=dialog.locator('.memory-entry').filter({has:page.locator('.memory-text',{hasText:'我叫小林'})});
  await name.getByRole('button',{name:'更正',exact:true}).click();
  await page.locator('#memoryText').fill('我叫小周'); await page.locator('#saveMemory').click();
  await expect(dialog.locator('.memory-text').filter({hasText:'我叫小林'})).toHaveCount(0);
  await expect(dialog.locator('.memory-text').filter({hasText:'我叫小周'})).toHaveCount(1);
  const activity=dialog.locator('.memory-entry').filter({has:page.locator('.memory-text',{hasText:'我正在写论文'})});
  await activity.getByRole('button',{name:'结束 / 撤回'}).click();
  await expect(dialog.locator('.memory-entry')).toHaveCount(3);
  await page.locator('#memoryFilter').selectOption('history'); await expect(dialog.locator('.memory-entry')).toContainText('我正在写论文');
  await page.locator('#memoryFilter').selectOption('active');
  const emotion=dialog.locator('.memory-entry').filter({has:page.locator('.memory-text',{hasText:'我很焦虑'})});
  await emotion.getByRole('button',{name:'删除',exact:true}).click(); await expect(dialog.locator('.memory-entry')).toHaveCount(2);
  await page.locator('#memoryKind').selectOption('activity'); await page.locator('#memoryText').fill('我在准备面试'); await page.locator('#saveMemory').click();
  await expect(dialog.locator('.memory-entry')).toHaveCount(3);
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await page.screenshot({path:`artifacts/${testInfo.project.name}-memory.png`,fullPage:true});
  await page.locator('#closeMemory').click(); await page.reload();
  await say(page,'我叫什么'); await expect(page.locator('.message.assistant').last()).toContainText('小周');
  expect(errors).toEqual([]);
});

test('capture and recall settings persist; clearing chat preserves memory and clearing memory removes all entries', async ({page})=>{
  await page.goto('/'); await say(page,'我叫小林');
  await page.locator('#openMemory').click(); await expect(page.locator('.memory-entry')).toHaveCount(1);
  await page.locator('#captureMemory').uncheck(); await expect(page.locator('#captureMemory')).toBeEnabled();
  await page.locator('#recallMemory').uncheck(); await expect(page.locator('#recallMemory')).toBeEnabled();
  await page.locator('#closeMemory').click(); await say(page,'我正在准备面试');
  await page.locator('#openMemory').click(); await expect(page.locator('.memory-entry')).toHaveCount(1);
  await expect(page.locator('#captureMemory')).not.toBeChecked(); await expect(page.locator('#recallMemory')).not.toBeChecked();
  await page.locator('#memoryKind').selectOption('profile'); await page.locator('#memoryText').fill('我喜欢读书'); await page.locator('#saveMemory').click();
  await expect(page.locator('.memory-entry')).toHaveCount(2); await page.locator('#closeMemory').click();
  page.once('dialog',d=>d.accept()); await page.locator('#clearChat').click(); await expect(page.locator('.message')).toHaveCount(0);
  await page.locator('#openMemory').click(); await expect(page.locator('.memory-entry')).toHaveCount(2);
  page.once('dialog',d=>d.accept()); await page.locator('#clearMemory').click(); await expect(page.locator('.memory-entry')).toHaveCount(0);
  await page.locator('#closeMemory').click(); await page.reload(); await page.locator('#openMemory').click();
  await expect(page.locator('#memorySummary')).toContainText('0 条有效'); await expect(page.locator('#captureMemory')).not.toBeChecked();
});
