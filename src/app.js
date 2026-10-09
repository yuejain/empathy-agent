'use strict';
const $ = id => document.getElementById(id);
let sessionId;
try {
  sessionId = localStorage.getItem('empathy-agent-conversation-id');
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(sessionId || '')) { sessionId = crypto.randomUUID(); localStorage.setItem('empathy-agent-conversation-id', sessionId); }
} catch { sessionId = crypto.randomUUID(); }
let controller = null, ready = false, history = [], mode = 'demo', pendingStop = null;
let cloudModel = '';
function modelNotice() {
  $('modeNotice').textContent = mode === 'demo' ? '当前为本地规则演示，回复由模板生成。配置云端模型后，可使用情绪 RAG 增强回复。'
    : `本地小模型提供情绪分析和检索参考，由 ${cloudModel} 生成回复。消息、情绪线索、近期上下文、相关长期记忆及检索片段会发送给已配置的云端服务。`;
}
const phaseNames = { INIT: '开始倾听', EMPATHY_PHASE: '倾听与共情', EXPLORE_PHASE: '一起梳理', ACTION_PHASE: '尝试小步行动', REVIEW_PHASE: '回顾与整理', TAROT_ENTRY: '卡牌联想', SESSION_CLOSE: '暂时告一段落', SAFETY_PROTOCOL: '安全支持' };
const headers = () => ({ 'Content-Type': 'application/json', 'makers-conversation-id': sessionId });
function showError(message) { $('error').textContent = message; $('error').hidden = !message; }
function setBusy(busy) {
  $('userInput').disabled = !ready || busy;
  $('sendButton').disabled = !ready || busy || !$('userInput').value.trim();
  $('newChat').disabled = $('clearChat').disabled = $('exportChat').disabled = !ready || busy;
  $('playGame').disabled = $('game').disabled = !ready || busy;
  $('openMemory').disabled = !ready || busy;
  document.querySelectorAll('[data-prompt]').forEach(b => b.disabled = !ready || busy);
  $('stopButton').hidden = !busy; $('pending').hidden = !busy;
}
function scrollBottom() { $('chatScroll').scrollTop = $('chatScroll').scrollHeight; }
function addMessage(role, content, meta = '') {
  $('welcome').hidden = true;
  const row = document.createElement('div'); row.className = 'message ' + role;
  if (role === 'assistant') { const avatar = document.createElement('span'); avatar.className = 'avatar'; avatar.textContent = '◒'; avatar.setAttribute('aria-hidden', 'true'); row.appendChild(avatar); }
  const text = document.createElement('div'); text.className = 'message-content'; text.textContent = content;
  if (meta) { const note = document.createElement('div'); note.className = 'message-meta'; note.textContent = meta; text.appendChild(note); }
  row.appendChild(text); $('messages').appendChild(row); scrollBottom(); return row;
}
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: headers() });
  if (!response.ok) {
    let data; try { data = await response.json(); } catch { /* error may be a proxy page */ }
    throw new Error(data?.error || `请求失败（${response.status}），请重试。`);
  }
  return response;
}
async function loadSession() {
  const data = await (await api('/api/session')).json();
  history = data.history;
  $('messages').replaceChildren(); $('welcome').hidden = history.length > 0;
  history.forEach(t => addMessage(t.role, t.content));
  $('turnCount').textContent = data.turnCount;
  $('phase').textContent = phaseNames[data.state] || data.state;
  $('memoryCount').textContent = data.memories.length;
}
async function initialize() {
  try {
    const response = await fetch('/api/health');
    if (!response.ok) throw new Error('服务状态检查失败，请刷新页面重试。');
    const health = await response.json(); mode = health.mode;
    cloudModel = health.model;
    try { localStorage.removeItem('empathy-backend'); } catch {}
    $('replyModel').textContent = mode === 'demo' ? '规则演示' : `云端回复 · ${cloudModel}`;
    $('knowledgeStatus').textContent = health.local?.available ? `本地情绪 RAG · ${health.local.indexDocuments} 条` : '本地情绪 RAG 未连接 · 使用基础情绪线索';
    $('mode').textContent = mode === 'demo' ? '演示模式' : '模型已配置';
    $('modeNotice').textContent = mode === 'demo'
      ? '当前为本地规则演示，回复由模板生成。配置本地 .env 并重启服务后，可使用真实模型对话。'
      : `使用模型 ${health.model}。发送的消息及本会话上下文会交给你配置的模型服务处理。`;
    modelNotice();
    $('storageNote').textContent = health.persistence ? '聊天保留最近 10 轮，7 天未活动后清理。长期记忆独立保存在本机，按类别更新和过期。' : '聊天与长期记忆仅存于本次服务内存，服务重启后清除。';
    await loadSession(); ready = true; setBusy(false); $('userInput').focus();
  } catch (error) { $('mode').textContent = '连接失败'; showError(error.message); }
}
async function sendMessage() {
  const message = $('userInput').value.trim();
  if (!ready || controller || !message) return;
  if (message.length > 2000) { showError('消息不能超过 2000 个字符。'); return; }
  showError(''); controller = new AbortController(); setBusy(true);
  const sentRow = addMessage('user', message); $('userInput').value = '';
  let received = false, finished = false, partialRow = null, partialText = '';
  try {
    const response = await api('/api/chat', { method: 'POST', body: JSON.stringify({ message }), signal: controller.signal });
    if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('服务没有返回有效的消息流。');
    const reader = response.body.getReader(), decoder = new TextDecoder();
    const parser = createSSEParser(event => {
      if (event.data === '[DONE]') { finished = true; return; }
      const data = JSON.parse(event.data);
      if (event.event === 'ping' || data.type === 'ping') return;
      if (data.type === 'error_message') throw new Error(data.content || '生成失败，请重试。');
      if (data.type === 'ai_delta' && typeof data.content === 'string') {
        if (!partialRow) partialRow = addMessage('assistant', '');
        partialText += data.content;
        partialRow.querySelector('.message-content').textContent = partialText;
        $('pending').textContent = '◒ 正在回复…'; scrollBottom();
      }
      if (data.type === 'ai_response' && typeof data.content === 'string') {
        received = true;
        if (partialRow) partialRow.querySelector('.message-content').textContent = data.content;
        else addMessage('assistant', data.content, data.mode === 'demo' ? '本地演示回复' : '');
        const row = partialRow || $('messages').lastElementChild;
        if (data.rag?.direction) {
          const note = document.createElement('details'); note.className = 'source-note emotion-note';
          const title = document.createElement('summary'); title.textContent = `本轮情绪参考 · ${data.rag.direction.label}`; note.appendChild(title);
          const text = document.createElement('p');
          const fallback = ['unavailable','not_configured'].includes(data.rag.status);
          text.textContent = fallback ? '本地 RAG 当前不可用，云端使用当前原话和基础情绪线索作答，本轮未引用检索语料。'
            : `${data.rag.emotion.primary}（${data.rag.emotion.uncertain ? '不确定线索，请以你的感受为准' : '模型线索，非诊断'}）。${data.rag.status === 'no_matches' ? '未找到合适语料。' : `参考 ${data.rag.evidenceCount} 条语料。`}`;
          note.appendChild(text); row.querySelector('.message-content').appendChild(note);
          if (fallback) $('knowledgeStatus').textContent = '本轮 RAG 不可用 · 已使用基础情绪线索';
          else $('knowledgeStatus').textContent = '本地情绪 RAG 已参与本轮回复';
        }
        if (Array.isArray(data.sources) && data.sources.length) {
          const note = document.createElement('details'); note.className = 'source-note';
          const title = document.createElement('summary'); title.textContent = '本轮参考语料来源'; note.appendChild(title);
          for (const source of data.sources) {
            try {
              const url = new URL(source.source_url); if (url.protocol !== 'https:') continue;
              const link = document.createElement('a'); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
              link.textContent = `${source.source} · ${source.license}`; note.appendChild(link);
            } catch { /* Ignore malformed source metadata. */ }
          }
          row.querySelector('.message-content').appendChild(note);
        }
        history.push({ role: 'user', content: message }, { role: 'assistant', content: data.content });
        $('phase').textContent = data.state.phase;
        $('turnCount').textContent = data.state.turnCount;
        if (data.memory?.memoriesUpdated || data.memory?.memoriesUsed) {
          const note = document.createElement('div'); note.className = 'message-meta';
          note.textContent = `长期记忆：${data.memory.memoriesUpdated || 0} 次更新 · 本轮参考 ${data.memory.memoriesUsed || 0} 条`;
          row.querySelector('.message-content').appendChild(note);
        }
      }
    });
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        parser.feed(decoder.decode(value, { stream: true }));
      }
      parser.feed(decoder.decode()); parser.finish();
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    if (!finished || !received) throw new Error('回复未完成。原消息已放回输入框，可重试。');
    const saved = await (await api('/api/session')).json();
    $('memoryCount').textContent = saved.memories.length;
    history = saved.history;
  } catch (error) {
    const stopped = controller?.signal.aborted;
    if (!received) {
      sentRow.remove(); $('userInput').value = message; $('welcome').hidden = history.length > 0;
      partialRow?.remove();
    }
    showError(stopped ? '已停止回复。' : error.message || '网络连接失败，请重试。');
  } finally {
    // Wait for the stop endpoint before allowing a new request to the same session.
    if (pendingStop) await pendingStop;
    pendingStop = null; controller = null; setBusy(false); $('userInput').focus();
    $('pending').textContent = '◒ 正在整理回复…';
  }
}
$('chatForm').addEventListener('submit', event => { event.preventDefault(); sendMessage(); });
$('playGame').addEventListener('click', () => { $('userInput').value = {tarot:'我想抽一张塔罗牌，做正逆位联想练习。',iching:'我想做周易六爻意象联想练习。',needs:'我想抽一张情绪需要卡。'}[$('game').value]; sendMessage(); });
$('userInput').addEventListener('input', () => { $('sendButton').disabled = !ready || !!controller || !$('userInput').value.trim(); });
$('userInput').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); sendMessage(); }
});
$('stopButton').addEventListener('click', () => {
  if (!controller) return;
  pendingStop = api('/api/stop', { method: 'POST', signal: AbortSignal.timeout(5000) }).catch(() => {});
  controller.abort();
});
document.querySelectorAll('[data-prompt]').forEach(button => button.addEventListener('click', () => { $('userInput').value = button.dataset.prompt; sendMessage(); }));
$('newChat').addEventListener('click', async () => {
  setBusy(true);
  sessionId = crypto.randomUUID();
  try { localStorage.setItem('empathy-agent-conversation-id', sessionId); } catch { /* storage disabled */ }
  showError('');
  try { await loadSession(); } catch (error) { showError(error.message); } finally { setBusy(false); $('userInput').focus(); }
});
$('clearChat').addEventListener('click', async () => {
  if (!confirm('清除这段聊天记录？长期记忆将保留，可在“长期记忆”中单独清空。')) return;
  setBusy(true); showError('');
  try { await api('/api/session', { method: 'DELETE' }); await loadSession(); } catch (error) { showError(error.message); } finally { setBusy(false); }
});
$('exportChat').addEventListener('click', () => {
  const content = history.map(t => `${t.role === 'user' ? '我' : '助手'}：${t.content}`).join('\n\n');
  const url = URL.createObjectURL(new Blob([content || '暂无聊天记录'], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = '留白-对话记录.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
let memoryData = null, editingMemory = null, memoryBusy = false;
const memoryStatuses = { active: '有效', pending: '待核对', superseded: '被新信息替代', resolved: '已结束 / 撤回', expired: '已过期' };
const memorySources = { explicit: '明确要求记住', statement: '聊天自动提取', extracted: '模型提取原话', confirmed: '手动添加 / 更正', legacy: '旧版记录迁移' };
const memoryCertainty = { stated: '用户陈述', inferred: '推测线索', tentative: '考虑中 / 计划' };
function memoryError(message) { $('memoryError').textContent = message; $('memoryError').hidden = !message; }
function memoryControls(busy) {
  memoryBusy = busy;
  $('memoryDialog').querySelectorAll('button,input,select,textarea').forEach(node => { if (node.id !== 'closeMemory') node.disabled = busy; });
}
function resetMemoryForm() {
  editingMemory = null; $('memoryText').value = ''; $('saveMemory').textContent = '添加记忆'; $('cancelMemoryEdit').hidden = true;
}
function renderMemory() {
  if (!memoryData) return;
  $('captureMemory').checked = memoryData.settings.capture;
  $('recallMemory').checked = memoryData.settings.recall;
  $('memoryCount').textContent = memoryData.activeCount;
  $('memorySummary').textContent = `${memoryData.activeCount} 条有效 · ${memoryData.pendingCount} 条待核对`;
  $('memoryList').replaceChildren();
  const filter = $('memoryFilter').value;
  const items = memoryData.entries.filter(e => filter === 'all' || filter === 'history' && !['active', 'pending'].includes(e.status) || e.status === filter);
  if (!items.length) { const p = document.createElement('p'); p.className = 'memory-empty'; p.textContent = '这里还没有记忆。聊聊近况，或者手动添加一条。'; $('memoryList').appendChild(p); }
  for (const item of items) {
    const card = document.createElement('article'); card.className = 'memory-entry'; card.dataset.memoryId = item.id;
    const badge = document.createElement('div'); badge.className = 'memory-badge'; badge.textContent = `${item.label} · ${memoryStatuses[item.status]} · ${memoryCertainty[item.certainty]}`;
    const text = document.createElement('p'); text.className = 'memory-text'; text.textContent = item.text;
    const time = document.createElement('p'); time.className = 'memory-hint'; time.textContent = `${memorySources[item.source]} · 更新 ${new Date(item.updatedAt).toLocaleString()} · 有效至 ${new Date(item.expiresAt).toLocaleString()}`;
    const details = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = '查看原话依据'; details.appendChild(summary);
    for (const evidence of item.evidence) { const quote = document.createElement('blockquote'); quote.textContent = evidence.quote; details.appendChild(quote); }
    const actions = document.createElement('div'); actions.className = 'memory-actions';
    const action = (label, fn) => { const button = document.createElement('button'); button.type = 'button'; button.className = 'text-button'; button.textContent = label; button.addEventListener('click', fn); actions.appendChild(button); };
    action('更正', () => { editingMemory = item.id; $('memoryKind').value = item.kind; $('memoryText').value = item.text; $('saveMemory').textContent = '保存更正'; $('cancelMemoryEdit').hidden = false; $('memoryText').focus(); });
    if (item.status === 'pending' || item.status === 'expired') action('确认仍然适用', () => changeMemory({ action: 'confirm', id: item.id }));
    if (item.status === 'active' && ['activity', 'decision'].includes(item.kind)) action('结束 / 撤回', () => changeMemory({ action: 'resolve', id: item.id }));
    action('删除', () => changeMemory({ action: 'delete', id: item.id }));
    card.append(badge, text, time, details, actions); $('memoryList').appendChild(card);
  }
}
async function refreshMemory() {
  if (memoryBusy) return;
  memoryControls(true); memoryError('');
  try { memoryData = await (await api('/api/memories')).json(); renderMemory(); }
  catch (error) { memoryError(error.message); }
  finally { memoryControls(false); }
}
async function changeMemory(operation) {
  if (memoryBusy || !memoryData) return;
  memoryControls(true); memoryError('');
  try {
    memoryData = await (await api('/api/memories', { method: 'POST', body: JSON.stringify({ revision: memoryData.revision, ...operation }) })).json();
    if (['add', 'edit', 'clear'].includes(operation.action) || operation.id === editingMemory) resetMemoryForm();
    renderMemory();
  } catch (error) { renderMemory(); memoryError(error.message); }
  finally { memoryControls(false); }
}
$('openMemory').addEventListener('click', () => { $('memoryDialog').showModal(); refreshMemory(); });
$('closeMemory').addEventListener('click', () => $('memoryDialog').close());
$('refreshMemory').addEventListener('click', refreshMemory);
$('memoryFilter').addEventListener('change', renderMemory);
$('cancelMemoryEdit').addEventListener('click', resetMemoryForm);
$('captureMemory').addEventListener('change', () => changeMemory({ action: 'settings', capture: $('captureMemory').checked }));
$('recallMemory').addEventListener('change', () => changeMemory({ action: 'settings', recall: $('recallMemory').checked }));
$('memoryForm').addEventListener('submit', event => { event.preventDefault(); changeMemory({ action: editingMemory ? 'edit' : 'add', ...(editingMemory ? { id: editingMemory } : {}), kind: $('memoryKind').value, text: $('memoryText').value.trim() }); });
$('clearMemory').addEventListener('click', () => { if (confirm('清空全部长期记忆？旧聊天将退出后续模型上下文，界面中已有的聊天文字仍保留。')) changeMemory({ action: 'clear' }); });
setBusy(false); initialize();
