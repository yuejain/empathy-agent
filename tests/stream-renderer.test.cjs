const test = require('node:test');
const assert = require('node:assert/strict');
const { createStreamRenderer } = require('../src/stream-renderer.js');

function fixture() {
  const callbacks = new Map(), appended = [], replaced = []; let id = 0;
  const renderer = createStreamRenderer({
    appendText: text => appended.push(text), replaceText: text => replaced.push(text),
    requestFrame: fn => { callbacks.set(++id,fn); return id; }, cancelFrame: id => callbacks.delete(id),
  });
  return {renderer,callbacks,appended,replaced,tick() { const pending=[...callbacks.values()];callbacks.clear();pending.forEach(fn=>fn()); }};
}

test('stream fragments are appended once per frame instead of replacing the growing reply per token',()=>{
  const f=fixture(); for(let i=0;i<1000;i++)f.renderer.append('字');
  assert.equal(f.callbacks.size,1);assert.deepEqual(f.appended,[]);
  f.tick();assert.deepEqual(f.appended,['字'.repeat(1000)]);
  f.renderer.append('下一段');f.tick();assert.deepEqual(f.appended,['字'.repeat(1000),'下一段']);
});

test('authoritative final text cancels queued fragments and cannot be overwritten by late callbacks',()=>{
  const f=fixture();f.renderer.append('初始');f.tick();f.renderer.append('待显示');
  const late=[...f.callbacks.values()][0];
  f.renderer.finish('已过滤的最终文本');late();f.renderer.append('结束后的无效片段');f.tick();
  assert.deepEqual(f.appended,['初始']);assert.deepEqual(f.replaced,['已过滤的最终文本']);assert.equal(f.callbacks.size,0);
});

test('stop or error discards queued fragments, including a frame already handed to the browser',()=>{
  const f=fixture();f.renderer.append('不得残留');const late=[...f.callbacks.values()][0];
  f.renderer.cancel();late();f.renderer.flush();f.renderer.finish('不得恢复');
  assert.deepEqual(f.appended,[]);assert.deepEqual(f.replaced,[]);assert.equal(f.callbacks.size,0);
});

test('finishing an already rendered identical reply makes no redundant text mutation',()=>{
  const f=fixture();f.renderer.append('完整文字');f.renderer.flush();f.renderer.finish('完整文字');
  assert.deepEqual(f.appended,['完整文字']);assert.deepEqual(f.replaced,[]);assert.equal(f.callbacks.size,0);
});
