export function sseEvent(data: unknown, eventType?: string): string {
  return `${eventType ? `event: ${eventType}\n` : ''}data: ${JSON.stringify(data)}\n\n`;
}

export function createSSEResponse(generator: (signal: AbortSignal) => AsyncGenerator<string>, signal?: AbortSignal): Response {
  const abort = new AbortController();
  const onAbort = () => abort.abort();
  if (signal?.aborted) abort.abort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const heartbeat = setInterval(() => {
        if (!cancelled && !abort.signal.aborted) controller.enqueue(encoder.encode(sseEvent({}, 'ping')));
      }, 10000);
      try {
        for await (const chunk of generator(abort.signal)) {
          if (cancelled || abort.signal.aborted) break;
          controller.enqueue(encoder.encode(chunk));
        }
      } catch {
        if (!cancelled && !abort.signal.aborted) controller.enqueue(encoder.encode(sseEvent({ type: 'error_message', content: '请求处理失败，请重试。' }, 'error_message')));
      } finally {
        clearInterval(heartbeat);
        signal?.removeEventListener('abort', onAbort);
        if (!cancelled) controller.close();
      }
    },
    cancel() { cancelled = true; abort.abort(); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-store', 'X-Accel-Buffering': 'no' } });
}
