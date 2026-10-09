import { ConversationOrchestrator } from '../../lib/orchestrator';
import { OrchestratorOutput } from '../../lib/orchestrator/types';
import { GatewayError } from '../../lib/gateway';
import { createSSEResponse, sseEvent } from '../_shared';

export const phases: Record<string, string> = {
  INIT: '开始倾听', EMPATHY_PHASE: '倾听与共情', EXPLORE_PHASE: '一起梳理', ACTION_PHASE: '尝试小步行动',
  REVIEW_PHASE: '回顾与整理', TAROT_ENTRY: '卡牌联想', SESSION_CLOSE: '暂时告一段落', SAFETY_PROTOCOL: '安全支持',
};

export function responseEvent(result: OrchestratorOutput) {
  const m = result.metadata;
  return { type: 'ai_response', content: result.response,
    emotion: { primary: m.emotion.primaryEmotion, intensity: m.emotion.intensity, valence: m.emotion.valence, trajectory: m.emotion.trajectory },
    empathy: { level: m.empathyLevel }, safety: { isSafe: !m.safetyResult.shouldBlock, riskLevel: m.safetyResult.riskLevel },
    state: { current: m.state, phase: phases[m.state] || m.state, turnCount: result.updatedState.turnCount },
    memory: { memoriesUsed: m.memoryUsed, memoriesUpdated: m.memoryUpdated, processingTimeMs: m.processingTimeMs }, mode: m.mode,
    sources: m.sources || [], analysisSource: m.analysisSource, backend: m.backend,
  };
}

/** Portable fetch-style adapter. Local runtime adds persistence, ownership and request limits. */
export function createAgent(env: Record<string, string>) {
  const orchestrator = new ConversationOrchestrator(env);
  const active = new Set<string>();
  return async (request: Request, sessionId: string): Promise<Response> => {
    if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });
    if (!/^[a-zA-Z0-9_-]{16,100}$/.test(sessionId)) return Response.json({ error: 'Invalid session id' }, { status: 400 });
    let body: unknown;
    try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
    const message = body && typeof body === 'object' ? (body as { message?: unknown }).message : undefined;
    if (typeof message !== 'string' || !message.trim() || message.length > 2000) return Response.json({ error: 'Message must contain 1–2000 characters' }, { status: 400 });
    if (active.has(sessionId)) return Response.json({ error: 'Session busy' }, { status: 409 });
    active.add(sessionId);
    return createSSEResponse(async function* (signal) {
      const queue: string[] = [];
      let done = false, wake: (() => void) | undefined;
      const push = (event: string) => { queue.push(event); wake?.(); wake = undefined; };
      const work = orchestrator.processTurn({ userId: sessionId, sessionId, userInput: message.trim(), signal,
        onDelta: content => { push(sseEvent({ type: 'ai_delta', content }, 'ai_delta')); },
      }).then(result => push(sseEvent(responseEvent(result), 'ai_response'))).catch(error => {
        if (!signal.aborted) push(sseEvent({ type: 'error_message', content: error instanceof GatewayError ? error.message : '处理失败，请重试。' }, 'error_message'));
      }).finally(() => { done = true; wake?.(); });
      try {
        while (!done || queue.length) {
          if (!queue.length) await new Promise<void>(resolve => { wake = resolve; });
          while (queue.length) yield queue.shift()!;
        }
      } finally { await work; active.delete(sessionId); }
      yield 'data: [DONE]\n\n';
    }, request.signal);
  };
}

// Platform adapters must pass a verified, user-scoped session id. No shared default session.
const handlers = new WeakMap<object, ReturnType<typeof createAgent>>();
export async function onRequest(context: { request: Request; env: Record<string, string>; conversation_id?: string }) {
  let handler = handlers.get(context.env);
  if (!handler) { handler = createAgent(context.env); handlers.set(context.env, handler); }
  return handler(context.request, context.conversation_id || context.request.headers.get('makers-conversation-id') || '');
}
