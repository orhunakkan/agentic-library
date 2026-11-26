export type StubEvent = { type: string; [field: string]: unknown }

const sse = (event: StubEvent) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`

/** Streams the events as server-sent events, `delayMs` apart; `onAbort` runs once if the client hangs up first. */
export function sseResponse(events: StubEvent[], delayMs: number, signal: AbortSignal, onAbort: () => void): Response {
  const encoder = new TextEncoder()
  let stopped = false
  const stop = () => {
    if (stopped) return false
    stopped = true
    onAbort()
    return true
  }
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      signal.addEventListener('abort', () => {
        if (stop()) controller.error(new DOMException('The connection was closed', 'AbortError'))
      })
      for (const event of events) {
        if (stopped) return
        controller.enqueue(encoder.encode(sse(event)))
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
      }
      if (!stopped) {
        stopped = true
        controller.close()
      }
    },
    cancel() {
      stop()
    },
  })
  return new Response(body, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } })
}
