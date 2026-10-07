const { test, expect } = require('@playwright/test');

test('chat, persistence, memory, clear, and literal HTML rendering', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByText('演示模式', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox')).toBeEnabled();
  await expect(page.getByRole('button', { name: '发送 ↑' })).toBeDisabled();
  await page.getByRole('textbox').fill('记住：我叫小林');
  await page.getByRole('button', { name: '发送 ↑' }).click();
  await expect(page.locator('.message.assistant')).toContainText('已在本会话中记住');
  await expect(page.locator('#memoryCount')).toHaveText('1');
  await page.reload();
  await expect(page.locator('.message')).toHaveCount(2);
  await page.getByRole('textbox').fill('我叫什么');
  await page.getByRole('button', { name: '发送 ↑' }).click();
  await expect(page.locator('.message.assistant').last()).toContainText('小林');
  await page.getByRole('textbox').fill('<img src=x onerror="window.injected=true">');
  await page.getByRole('button', { name: '发送 ↑' }).click();
  await expect(page.locator('.message.user').last()).toContainText('<img src=x');
  await expect(page.locator('#messages img')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.injected)).toBeUndefined();
  await expect(page.getByRole('button', { name: '清除记录', exact: true })).toBeEnabled();
  page.once('dialog', d => d.accept());
  await page.getByRole('button', { name: '清除记录', exact: true }).click();
  await expect(page.locator('.message')).toHaveCount(0);
  await expect(page.locator('#welcome')).toBeVisible();
  await page.reload();
  await expect(page.locator('.message')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('prompt starters, fresh sessions, keyboard, and responsive layout', async ({ page }, testInfo) => {
  await page.goto('/'); await expect(page.getByRole('textbox')).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const starter = await page.getByRole('button', { name: /从一张牌开始/ }).boundingBox();
  const composer = await page.locator('.composer-area').boundingBox();
  expect(starter.y + starter.height).toBeLessThanOrEqual(composer.y);
  await page.screenshot({path:`artifacts/${testInfo.project.name}-welcome.png`,fullPage:true});
  await page.getByRole('button', { name: /从一张牌开始/ }).click();
  await expect(page.locator('.message.assistant')).toContainText('A.');
  await expect(page.getByRole('button', { name: '＋ 新的对话' })).toBeEnabled();
  await page.getByRole('button', { name: '＋ 新的对话' }).click();
  await expect(page.locator('#welcome')).toBeVisible();
  await page.getByRole('textbox').fill('最近有点迷茫');
  await page.getByRole('textbox').press('Enter');
  await expect(page.locator('.message.assistant')).toContainText('迷茫');
  await page.screenshot({path:`artifacts/${testInfo.project.name}-chat.png`,fullPage:true});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('named SSE errors and interrupted streams remain retryable', async ({ page }) => {
  await page.goto('/'); await expect(page.getByRole('textbox')).toBeEnabled();
  await page.route('**/api/chat', route => route.fulfill({ contentType:'text/event-stream', body:'event: error_message\ndata: {"type":"error_message","content":"模型认证失败，请检查密钥。"}\n\ndata: [DONE]\n\n' }));
  await page.getByRole('textbox').fill('想聊聊'); await page.getByRole('button', { name:'发送 ↑' }).click();
  await expect(page.getByRole('alert')).toContainText('模型认证失败');
  await expect(page.getByRole('textbox')).toHaveValue('想聊聊');
  await expect(page.getByRole('button', { name:'发送 ↑' })).toBeEnabled();
  await expect(page.locator('.message.assistant')).toHaveCount(0);
  await page.unroute('**/api/chat');
  await page.route('**/api/chat', route=>route.fulfill({contentType:'text/event-stream',body:'event: ping\ndata: {}\n\n'}));
  await page.getByRole('button', { name:'发送 ↑' }).click();
  await expect(page.getByRole('alert')).toContainText('回复未完成');
  await expect(page.getByRole('textbox')).toBeEnabled();
});

test('partial output is removed on failure and reflection games are available in a conversation',async({page})=>{
 await page.goto('/');await expect(page.getByRole('textbox')).toBeEnabled();
 await page.route('**/api/chat',route=>route.fulfill({contentType:'text/event-stream',body:'event: ai_delta\ndata: {"type":"ai_delta","content":"部分回复"}\n\nevent: error_message\ndata: {"type":"error_message","content":"流中断"}\n\ndata: [DONE]\n\n'}));
 await page.getByRole('textbox').fill('测试中断');await page.getByRole('button',{name:'发送 ↑'}).click();
 await expect(page.getByRole('alert')).toContainText('流中断');await expect(page.locator('.message.assistant')).toHaveCount(0);
 await expect(page.getByRole('textbox')).toHaveValue('测试中断');await page.unroute('**/api/chat');
 await page.locator('#game').selectOption('iching');await page.locator('#playGame').click();
 await expect(page.locator('.message.assistant')).toContainText('周易意象');
 await expect(page.getByRole('textbox')).toBeEnabled();
 await page.locator('#game').selectOption('needs');await page.locator('#playGame').click();
 await expect(page.locator('.message.assistant').last()).toContainText('情绪需要卡');
});
