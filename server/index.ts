import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ChatGateway, GatewayError, Environment } from '../lib/gateway';
import { ConversationOrchestrator } from '../lib/orchestrator';
import { responseEvent } from '../agents/empathy-agent';
import { sseEvent } from '../agents/_shared';
import { SessionStore } from './session-store';
import { LocalKnowledge } from '../lib/local-knowledge';
import { eligible, MemoryError, memoryView, mutateMemory } from '../lib/memory';
import { validReflection } from '../lib/tarot/reflection-session';
import { continuityOpening } from '../lib/context/continuity';

class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
const ID = /^[a-zA-Z0-9_-]{16,100}$/;
const ROOT = resolve(__dirname, '../..');

export function createApp(env: Environment = process.env, storeOverride?: SessionStore) {
  const gateway = new ChatGateway(env);
  const knowledge = new LocalKnowledge(env);
  const safeEnv = Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => typeof e[1] === 'string'));
  const orchestrator = new ConversationOrchestrator(safeEnv);
  const store = storeOverride || new SessionStore(env.SESSION_PERSISTENCE === 'false' ? undefined : resolve(env.DATA_DIR || resolve(ROOT, '.data'), 'sessions.json'));
  const active = new Map<string, AbortController>();
  const rate = new Map<string, { count: number; until: number }>();
  const assets = new Map([
    ['/', { content: readFileSync(resolve(ROOT, 'dist/public/index.html')), type: 'text/html; charset=utf-8' }],
    ['/app.js', { content: readFileSync(resolve(ROOT, 'dist/public/app.js')), type: 'text/javascript; charset=utf-8' }],
    ['/sse.js', { content: readFileSync(resolve(ROOT, 'dist/public/sse.js')), type: 'text/javascript; charset=utf-8' }],
    ['/continuity.js', { content: readFileSync(resolve(ROOT, 'dist/public/continuity.js')), type: 'text/javascript; charset=utf-8' }],
    ['/corpus.js', { content: readFileSync(resolve(ROOT, 'dist/public/corpus.js')), type: 'text/javascript; charset=utf-8' }],
    ['/experiments.js', { content: readFileSync(resolve(ROOT, 'dist/public/experiments.js')), type: 'text/javascript; charset=utf-8' }],
    ['/session-health.js', { content: readFileSync(resolve(ROOT, 'dist/public/session-health.js')), type: 'text/javascript; charset=utf-8' }],
    ['/styles.css', { content: readFileSync(resolve(ROOT, 'dist/public/styles.css')), type: 'text/css; charset=utf-8' }],
  ]);
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '')) throw new HttpError(403, '仅支持本机访问。');
      const origin = `http://${req.headers.host}`;
      if ((req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, '不允许跨站请求。');
      const url = new URL(req.url || '/', origin);
      const asset = assets.get(url.pathname);
      if (asset && (req.method === 'GET' || req.method === 'HEAD')) {
        res.setHeader('Content-Type', asset.type); res.end(req.method === 'HEAD' ? undefined : asset.content); return;
      }
      if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      if (url.pathname === '/api/health' && req.method === 'GET') {
        json(res, 200, { ok: true, mode: gateway.mode, model: gateway.mode === 'live' ? gateway.model : null,
          persistence: env.SESSION_PERSISTENCE !== 'false', maxMessageLength: 2000, local: await knowledge.health() }); return;
      }
      if (!['/api/session', '/api/session/health', '/api/chat', '/empathy-agent', '/api/stop', '/api/memories','/api/corpus'].includes(url.pathname)) throw new HttpError(404, '接口不存在。');
      const cookie = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('empathy-owner='))?.slice('empathy-owner='.length);
      const owner = cookie && /^[0-9a-f-]{36}$/.test(cookie) ? cookie : randomUUID();
      res.setHeader('Set-Cookie', `empathy-owner=${owner}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`);
      const sessionId = req.headers['makers-conversation-id'];
      if (typeof sessionId !== 'string' || !ID.test(sessionId)) throw new HttpError(400, '会话编号无效，请刷新页面。');
      const key = `${owner}:${sessionId}`;
      const ownerBusy = () => [...active.keys()].some(k => k.startsWith(owner + ':'));
      if(url.pathname==='/api/session/health') {
        if(req.method!=='GET')throw new HttpError(405,'请求方法不支持。');
        json(res,200,orchestrator.checkSessionHealth(key,store.get(owner,sessionId)));return;
      }
      if (url.pathname === '/api/corpus') {
        if (!['GET','POST'].includes(req.method || '')) throw new HttpError(405,'请求方法不支持。');
        let operation: {action:'rebuild'|'update'|'retrain'|'rollback'} | {scheduleHours:0|24|168} | undefined;
        if (req.method === 'POST') {
          if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new HttpError(415,'请使用 JSON 请求。');
          const body = await readBody(req) as any;
          if (!body || typeof body !== 'object' || Object.keys(body).length !== 1) throw new HttpError(400,'语料操作格式无效。');
          if (['rebuild','update','retrain','rollback'].includes(body.action)) operation={action:body.action};
          else if ([0,24,168].includes(body.scheduleHours)) operation={scheduleHours:body.scheduleHours};
          else throw new HttpError(400,'语料操作格式无效。');
        }
        try { json(res,200,await knowledge.maintenance(operation)); } catch { throw new HttpError(503,'语料服务未连接或已有更新任务，请稍后刷新状态。'); }
        return;
      }
      if (url.pathname === '/api/memories') {
        if (req.method === 'GET') { json(res, 200, memoryView(store.getMemory(owner), Date.now())); return; }
        if (req.method !== 'POST') throw new HttpError(405, '请求方法不支持。');
        if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new HttpError(415, '请使用 JSON 请求。');
        const body = await readBody(req);
        if (ownerBusy()) throw new HttpError(409, '请先停止当前回复，再修改长期记忆。');
        const before = store.getMemory(owner);
        const updated = mutateMemory(before, body, { sessionId: key, turnId: 'manual', now: Date.now() });
        store.setMemory(owner, updated, before.revision);
        json(res, 200, memoryView(updated, Date.now())); return;
      }
      if (url.pathname === '/api/session') {
        if(req.method==='POST') {
          if(!req.headers['content-type']?.startsWith('application/json'))throw new HttpError(415,'请使用 JSON 请求。');
          const body=await readBody(req) as any;
          if(!body || Object.keys(body).length!==1 || !['continue','close'].includes(body.action))throw new HttpError(400,'会话操作格式无效。');
          if(ownerBusy())throw new HttpError(409,'请先停止当前回复。');
          const state=store.get(owner,sessionId);if(!state)throw new HttpError(404,'会话不存在。');
          if(state.currentState==='SAFETY_PROTOCOL')throw new HttpError(409,'安全支持期间请直接在对话中说明你的近况。');
          const now=new Date().toISOString();state.lastActiveAt=now;
          if(body.action==='continue'){state.healthCheckpoint={at:now,turnCount:state.turnCount};if(state.currentState==='SESSION_CLOSE')state.currentState='EMPATHY_PHASE';}
          else {state.currentState='SESSION_CLOSE';state.currentSubState=undefined;}
          store.set(owner,sessionId,state);json(res,200,{health:orchestrator.checkSessionHealth(key,state)});return;
        }
        if (req.method === 'GET') {
          const state = store.get(owner, sessionId);
          const memory = store.getMemory(owner);
          json(res, 200, { history: state?.recentHistory || [], turnCount: state?.turnCount || 0, state: state?.currentState || 'INIT', memories: memory.entries.filter(e => eligible(e, Date.now())).map(e => e.text), memory: memoryView(memory, Date.now()),reflection:validReflection(state?.reflection,memory.contextEpoch),opening:continuityOpening(memory),health:orchestrator.checkSessionHealth(key,state) }); return;
        }
        if (req.method === 'DELETE') {
          if (active.has(key)) throw new HttpError(409, '请先停止当前回复，再清除记录。');
          store.delete(owner, sessionId); orchestrator.clearSession(key);
          json(res, 200, { ok: true }); return;
        }
        throw new HttpError(405, '请求方法不支持。');
      }
      if (req.method !== 'POST') throw new HttpError(405, '请求方法不支持。');
      if (url.pathname === '/api/stop') { active.get(key)?.abort(); json(res, 200, { ok: true }); return; }
      if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new HttpError(415, '请使用 JSON 请求。');
      const body = await readBody(req);
      const message = body && typeof body === 'object' ? (body as { message?: unknown }).message : undefined;
      const backend = body && typeof body === 'object' ? (body as { backend?: unknown }).backend : undefined;
      if (backend === 'local') throw new HttpError(410, '本地生成已停用，未转发此消息。请刷新页面：本地模型负责情绪 RAG，云端模型负责回复。');
      if (backend !== undefined && backend !== 'cloud') throw new HttpError(400, '回复模型无效。');
      if (typeof message !== 'string' || !message.trim() || message.length > 2000) throw new HttpError(400, '消息长度应为 1–2000 个字符。');
      if (ownerBusy()) throw new HttpError(409, '你的另一段对话正在回复，请稍后再试。');
      if (active.size >= 8) throw new HttpError(503, '服务繁忙，请稍后再试。');
      const now = Date.now();
      for (const [id, entry] of rate) if (entry.until < now) rate.delete(id);
      if (!rate.has(owner) && rate.size >= 1000) throw new HttpError(429, '请求过于频繁，请稍后再试。');
      const limit = rate.get(owner) || { count: 0, until: now + 60000 };
      if (++limit.count > 20) throw new HttpError(429, '发送过于频繁，请稍后再试。');
      rate.set(owner, limit);
      const controller = new AbortController();
      active.set(key, controller);
      const disconnect = () => { if (!res.writableEnded) controller.abort(); };
      res.on('close', disconnect);
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'X-Accel-Buffering': 'no' });
      res.flushHeaders();
      const heartbeat = setInterval(() => { if (!res.destroyed) res.write(sseEvent({}, 'ping')); }, 10000);
      try {
        const memory = store.getMemory(owner);
        const result = await orchestrator.processTurn({ userId: owner, sessionId: key, userInput: message.trim(), sessionState: store.get(owner, sessionId), memoryProfile: memory, signal: controller.signal, backend,
          onDelta: async content => {
            controller.signal.throwIfAborted();
            if (!res.write(sseEvent({ type: 'ai_delta', content }, 'ai_delta'))) await once(res, 'drain', { signal: controller.signal });
          },
        });
        controller.signal.throwIfAborted();
        store.set(owner, sessionId, result.updatedState, result.updatedMemory, memory.revision);
        res.write(sseEvent(responseEvent(result), 'ai_response'));
      } catch (error) {
        if (!res.destroyed && !controller.signal.aborted) res.write(sseEvent({ type: 'error_message', code: error instanceof GatewayError ? error.code : 'INTERNAL', content: error instanceof GatewayError ? error.message : '处理或保存失败，请重试。' }, 'error_message'));
      } finally {
        clearInterval(heartbeat); active.delete(key); orchestrator.clearSession(key);
        res.off('close', disconnect);
        if (!res.destroyed) res.end('data: [DONE]\n\n');
      }
    } catch (error) {
      if (!res.headersSent) json(res, error instanceof HttpError || error instanceof MemoryError ? error.status : 500, { error: error instanceof HttpError || error instanceof MemoryError ? error.message : '服务暂时不可用。' });
      else res.end();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.on('close', () => { for (const controller of active.values()) controller.abort(); });
  return server;
}

function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value));
}
function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolveBody, reject) => {
    let size = 0, settled = false;
    const chunks: Buffer[] = [];
    const fail = (error: Error) => {
      if (settled) return;
      settled = true; chunks.length = 0; reject(error);
    };
    req.on('data', (chunk: Buffer) => {
      if (settled) return; // Drain excess bytes without accumulating or destroying the response socket.
      size += chunk.length;
      if (size > 16000) { fail(new HttpError(413, '请求内容过大。')); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      try { const body = JSON.parse(Buffer.concat(chunks).toString('utf8')); settled = true; resolveBody(body); }
      catch { fail(new HttpError(400, 'JSON 格式错误。')); }
    });
    req.on('error', () => fail(new HttpError(400, '请求连接中断。')));
    req.on('aborted', () => fail(new HttpError(400, '请求已取消。')));
  });
}

if (require.main === module) {
  try {
    const port = Number(process.env.PORT || 3000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须是 1 到 65535 的整数。');
    const app = createApp();
    app.on('error', (error: NodeJS.ErrnoException) => { console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用，请在 .env 修改 PORT。` : '本地服务启动失败。'); process.exitCode = 1; });
    app.listen(port, '127.0.0.1', () => console.log(`Empathy Agent: http://127.0.0.1:${port} (${new ChatGateway(process.env).mode})`));
    for (const event of ['SIGINT', 'SIGTERM'] as const) process.on(event, () => { app.close(); app.closeAllConnections(); });
  } catch (error) { console.error(error instanceof Error ? error.message : '启动失败'); process.exitCode = 1; }
}
