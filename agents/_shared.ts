/**
 * 共享辅助模块 - SSE事件构建和日志记录
 */

// SSE事件构建器
export function sseEvent(data: any, eventType?: string): string {
  const lines: string[] = [];
  if (eventType) {
    lines.push(`event: ${eventType}`);
  }
  lines.push(`data: ${JSON.stringify(data)}`);
  return lines.join('\n') + '\n\n';
}

// 创建SSE响应
export function createSSEResponse(
  generator: (signal?: AbortSignal) => AsyncGenerator<string>,
  signal?: AbortSignal
): Response {
  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    async start(controller) {
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(sseEvent({ type: 'ping' }, 'ping')));
        } catch (e) {
          clearInterval(heartbeat);
        }
      }, 5000);

      try {
        for await (const chunk of generator(signal)) {
          if (signal?.aborted) break;
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (e) {
        if ((e as Error).name !== 'AbortError' && !signal?.aborted) {
          controller.enqueue(encoder.encode(sseEvent(
            { type: 'error_message', content: (e as Error).message },
            'error_message'
          )));
        }
      } finally {
        clearInterval(heartbeat);
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

// 日志记录器
export const logger = {
  info: (message: string, data?: any) => {
    console.log(`[INFO] ${message}`, data || '');
  },
  error: (message: string, error?: any) => {
    console.error(`[ERROR] ${message}`, error || '');
  },
  warn: (message: string, data?: any) => {
    console.warn(`[WARN] ${message}`, data || '');
  },
  debug: (message: string, data?: any) => {
    console.debug(`[DEBUG] ${message}`, data || '');
  }
};