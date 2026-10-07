/** One OpenAI-compatible transport for generation and classifiers. No secrets reach the browser. */
export type Environment = Record<string, string | undefined>;
export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

export class GatewayError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'GatewayError'; }
}

export function completionUrl(base: string): string {
  const url = new URL(base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new GatewayError('CONFIG', '模型地址必须是不含账号、查询参数的 HTTP(S) 地址。');
  }
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path.endsWith('/chat/completions') ? path : `${path || '/v1'}/chat/completions`;
  return url.toString();
}

export class ChatGateway {
  readonly mode: 'demo' | 'live';
  readonly model: string;
  private url = '';
  private key: string;
  private timeout: number;
  private thinking?: 'enabled' | 'disabled';
  private tokenParam: 'max_tokens' | 'max_completion_tokens';

  constructor(env: Environment) {
    this.key = (env.AI_GATEWAY_API_KEY || env.OPENAI_API_KEY || '').trim();
    const base = (env.AI_GATEWAY_BASE_URL || env.OPENAI_BASE_URL || '').trim();
    this.model = (env.AI_GATEWAY_MODEL || env.OPENAI_MODEL || '').trim();
    const requested = env.APP_MODE || 'auto';
    if (!['auto', 'demo', 'live'].includes(requested)) throw new GatewayError('CONFIG', 'APP_MODE 应为 auto、demo 或 live。');
    this.mode = requested === 'demo' || (requested === 'auto' && !base && !this.model && !this.key) ? 'demo' : 'live';
    if (this.mode === 'live') {
      if (!base || !this.model) throw new GatewayError('CONFIG', '请在 .env 中设置 AI_GATEWAY_BASE_URL 和 AI_GATEWAY_MODEL。');
      this.url = completionUrl(base);
    }
    this.timeout = Number(env.AI_TIMEOUT_MS || 45000);
    if (!Number.isInteger(this.timeout) || this.timeout < 100 || this.timeout > 120000) {
      throw new GatewayError('CONFIG', 'AI_TIMEOUT_MS 应为 100 到 120000 的整数。');
    }
    const thinking = (env.AI_GATEWAY_THINKING || '').trim();
    if (thinking !== '' && thinking !== 'enabled' && thinking !== 'disabled') {
      throw new GatewayError('CONFIG', 'AI_GATEWAY_THINKING 应为空、enabled 或 disabled。');
    }
    this.thinking = thinking || undefined;
    const tokenParam = (env.AI_GATEWAY_TOKEN_PARAM || 'max_tokens').trim();
    if (tokenParam !== 'max_tokens' && tokenParam !== 'max_completion_tokens') {
      throw new GatewayError('CONFIG', 'AI_GATEWAY_TOKEN_PARAM 应为 max_tokens 或 max_completion_tokens。');
    }
    this.tokenParam = tokenParam;
  }

  async complete(messages: ChatMessage[], options: { signal?: AbortSignal; temperature?: number; maxTokens?: number } = {}): Promise<string> {
    if (this.mode !== 'live') throw new GatewayError('CONFIG', '演示模式不调用模型。');
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.throwIfAborted();
    options.signal?.addEventListener('abort', abort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeout);
    try {
      const response = await fetch(this.url, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...(this.key ? { Authorization: `Bearer ${this.key}` } : {}) },
        body: JSON.stringify({ model: this.model, messages, temperature: options.temperature ?? 0.7,
          [this.tokenParam]: options.maxTokens ?? 800, stream: false,
          ...(this.thinking ? { thinking: { type: this.thinking } } : {}),
        }),
      });
      if (!response.ok) {
        // Provider bodies can echo credentials and user content; never relay or log them.
        await response.body?.cancel();
        const code = response.status === 401 || response.status === 403 ? 'AUTH' : response.status === 429 ? 'RATE_LIMIT' : 'UPSTREAM';
        throw new GatewayError(code, code === 'AUTH' ? '模型认证失败，请检查本地 .env 中的密钥。' : code === 'RATE_LIMIT' ? '模型服务暂时限流，请稍后重试。' : `模型服务暂时不可用（HTTP ${response.status}）。`);
      }
      const data = await response.json() as { choices?: { message?: { content?: unknown } }[] };
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim() || content.length > 32000) throw new GatewayError('INVALID_RESPONSE', '模型返回了空白或无法识别的回复，请重试。');
      return content.trim();
    } catch (error) {
      options.signal?.throwIfAborted();
      if (error instanceof GatewayError) throw error;
      throw new GatewayError(timedOut ? 'TIMEOUT' : 'NETWORK', timedOut ? '模型响应超时，请稍后重试。' : '无法连接模型服务，请检查地址和网络。');
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    }
  }

  /** Consume the provider's SSE as it arrives. Reasoning fields are never forwarded. */
  async *stream(messages: ChatMessage[], options: { signal?: AbortSignal; temperature?: number; maxTokens?: number } = {}): AsyncGenerator<string> {
    if (this.mode !== 'live') throw new GatewayError('CONFIG', '演示模式不调用模型。');
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.throwIfAborted();
    options.signal?.addEventListener('abort', abort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeout);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await fetch(this.url, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...(this.key ? { Authorization: `Bearer ${this.key}` } : {}) },
        body: JSON.stringify({ model: this.model, messages, temperature: options.temperature ?? 0.7,
          [this.tokenParam]: options.maxTokens ?? 800, stream: true,
          ...(this.thinking ? { thinking: { type: this.thinking } } : {}),
        }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        const code = [401, 403].includes(response.status) ? 'AUTH' : response.status === 429 ? 'RATE_LIMIT' : 'UPSTREAM';
        throw new GatewayError(code, code === 'AUTH' ? '模型认证失败，请检查本地密钥。' : code === 'RATE_LIMIT' ? '模型服务暂时限流，请稍后重试。' : `模型服务暂时不可用（HTTP ${response.status}）。`);
      }
      if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
        await response.body?.cancel();
        throw new GatewayError('INVALID_RESPONSE', '模型服务没有返回有效的流式回复。');
      }
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '', content = '', ended = false, finish: string | undefined;
      while (!ended) {
        const chunk = await reader.read();
        buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
        if (buffer.length > 262144) throw new GatewayError('INVALID_RESPONSE', '模型消息帧过大。');
        // Normalize CRLF only when the LF is present; split CRLF is retained in buffer.
        buffer = buffer.replace(/\r\n/g, '\n');
        let boundary: number;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
          const payload = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
          if (!payload) continue;
          if (payload === '[DONE]') { ended = true; break; }
          let data: any;
          try { data = JSON.parse(payload); } catch { throw new GatewayError('INVALID_RESPONSE', '模型流包含无效消息。'); }
          if (data.error) throw new GatewayError('UPSTREAM', '模型服务中断了回复，请重试。');
          const choice = data.choices?.[0];
          if (choice?.finish_reason) finish = choice.finish_reason;
          const delta = choice?.delta?.content;
          if (typeof delta === 'string' && delta) {
            content += delta;
            if (content.length > 32000) throw new GatewayError('INVALID_RESPONSE', '模型回复过长。');
            yield delta;
          }
        }
        if (chunk.done) break;
      }
      if (!content.trim()) throw new GatewayError('INVALID_RESPONSE', '模型返回了空白回复，请重试。');
      if (!ended || finish !== 'stop') {
        throw new GatewayError('INCOMPLETE_STREAM', finish === 'length' ? '回复达到长度上限，尚未保存，请缩短问题后重试。' : '模型流未完整结束，尚未保存，请重试。');
      }
    } catch (error) {
      options.signal?.throwIfAborted();
      if (error instanceof GatewayError) throw error;
      throw new GatewayError(timedOut ? 'TIMEOUT' : 'NETWORK', timedOut ? '模型响应超时，请重试。' : '模型流连接中断，请重试。');
    } finally {
      await reader?.cancel().catch(() => {});
      reader?.releaseLock();
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    }
  }
}
