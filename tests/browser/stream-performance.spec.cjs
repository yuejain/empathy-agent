const {test,expect}=require('@playwright/test');

async function controlledStream(page) {
  await page.addInitScript(()=>{
    const fetchOriginal=window.fetch.bind(window);
    window.fetch=(input,options={})=>{
      if(input!=='/api/chat')return fetchOriginal(input,options);
      const body=new ReadableStream({start(controller){
        const encoder=new TextEncoder();
        window.testStream={
          send(data){controller.enqueue(encoder.encode(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`));},
          complete(){controller.enqueue(encoder.encode('data: [DONE]\n\n'));controller.close();},
        };
        options.signal?.addEventListener('abort',()=>controller.error(new DOMException('Stopped','AbortError')),{once:true});
      }});
      return Promise.resolve(new Response(body,{headers:{'Content-Type':'text/event-stream'}}));
    };
  });
  await page.goto('/');await expect(page.locator('#userInput')).toBeEnabled();
  await page.evaluate(()=>{
    window.testTextMutations=0;
    new MutationObserver(records=>{
      for(const record of records){const el=record.target.nodeType===Node.TEXT_NODE?record.target.parentElement:record.target;if(el?.classList.contains('message-content'))window.testTextMutations++;}
    }).observe(document.getElementById('messages'),{subtree:true,childList:true,characterData:true});
  });
  await page.locator('#userInput').fill('构造的流式渲染测试');await page.locator('#sendButton').click();
  await expect.poll(()=>page.evaluate(()=>!!window.testStream)).toBe(true);
}
async function frame(page){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
async function finish(page,content){
  await page.evaluate(content=>{
    testStream.send({type:'ai_response',content,mode:'live',state:{phase:'倾听与共情',turnCount:1},memory:{memoriesUsed:0,memoriesUpdated:0},sources:[{source:'fixture',source_url:'https://example.org/source',license:'fixture'}]});
    testStream.complete();
  },content);
  await expect(page.locator('#userInput')).toBeEnabled();
}

test('a burst of 800 SSE fragments produces bounded DOM mutations and final metadata survives',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await controlledStream(page);
  await page.evaluate(()=>{for(let i=0;i<800;i++)testStream.send({type:'ai_delta',content:'字'});});
  await expect(page.locator('.message.assistant .message-content')).toHaveText('字'.repeat(800));
  expect(await page.evaluate(()=>testTextMutations)).toBeLessThanOrEqual(4);
  const final='字'.repeat(800)+' <img src=x onerror=alert(1)> 最终文本';
  await finish(page,final);await frame(page);
  await expect(page.locator('.message.assistant .message-content')).toContainText(final);
  await expect(page.locator('.message.assistant img')).toHaveCount(0);
  await expect(page.locator('.message.assistant details')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('streaming follows the bottom until the reader scrolls up; stopping removes the partial turn',async({page})=>{
  await controlledStream(page);
  await page.evaluate(()=>testStream.send({type:'ai_delta',content:'第一段内容\n'.repeat(180)}));await frame(page);
  const bottom=await page.locator('#chatScroll').evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop);
  expect(bottom).toBeLessThan(5);
  await page.locator('#chatScroll').evaluate(el=>el.scrollTo({top:0,behavior:'instant'}));await frame(page);
  await page.evaluate(()=>{for(let i=0;i<300;i++)testStream.send({type:'ai_delta',content:'新增文字\n'});});await frame(page);
  expect(await page.locator('#chatScroll').evaluate(el=>el.scrollTop)).toBeLessThan(5);
  await page.locator('#stopButton').click();await expect(page.locator('#error')).toContainText('已停止');await frame(page);
  await expect(page.locator('.message.assistant')).toHaveCount(0);
  await expect(page.locator('#userInput')).toHaveValue('构造的流式渲染测试');
  await expect(page.locator('#sendButton')).toBeEnabled();
});

test('a stream error before the scheduled paint cannot resurrect a discarded reply',async({page})=>{
  await controlledStream(page);
  await page.evaluate(()=>{testStream.send({type:'ai_delta',content:'不得残留的半段'});testStream.send({type:'error_message',content:'构造中断'});testStream.complete();});
  await expect(page.locator('#error')).toContainText('构造中断');await frame(page);
  await expect(page.locator('.message.assistant')).toHaveCount(0);
  await expect(page.locator('#userInput')).toHaveValue('构造的流式渲染测试');
  await expect(page.locator('#sendButton')).toBeEnabled();
});

test('stopping after the committed response preserves final text and metadata while cancelling pending paint',async({page})=>{
  await controlledStream(page);
  await page.evaluate(()=>{
    testStream.send({type:'ai_delta',content:'未完成的缓冲片段'});
    testStream.send({type:'ai_response',content:'已经提交的完整回复',mode:'live',state:{phase:'倾听与共情',turnCount:1},memory:{memoriesUsed:1,memoriesUpdated:0}});
    // Keep the transport open after the committed response to exercise a late stop.
  });
  await expect(page.locator('.message.assistant')).toContainText('已经提交的完整回复');
  await page.locator('#stopButton').click();await expect(page.locator('#userInput')).toBeEnabled();await frame(page);
  await expect(page.locator('.message.assistant')).toHaveCount(1);
  await expect(page.locator('.message.assistant')).toContainText('已经提交的完整回复');
  await expect(page.locator('.message.assistant .message-meta')).toContainText('本轮参考 1 条');
  await expect(page.locator('.message.assistant')).not.toContainText('未完成的缓冲片段');
  await expect(page.locator('#error')).toContainText('回复已完成');
  await expect(page.locator('#userInput')).toHaveValue('');
});
