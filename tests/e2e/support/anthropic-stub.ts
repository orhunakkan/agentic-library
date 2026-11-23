export const STUB_KEYS = {
  rejected: 'reject',
  billing: 'nobill',
  overloaded: 'busy',
  rateLimited: 'limit',
  tooLong: 'toolong',
  refusal: 'refuse',
  midStreamError: 'break',
  slow: 'slow',
  badFormat: 'badfmt',
} as const

export const STUB_RIGHT_ANSWER = 'The stub’s right answer'

const stats = { aborted: 0 }

const keyOf = (request: Request) =>
  request.headers.get('x-api-key') ?? /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1] ?? ''

const HEADING = /^(Chapter \d+: .+, page \d+|Page \d+)\n\n/
const RETRY_NOW = { 'retry-after-ms': '0', 'retry-after': '0' }

function apiError(status: number, type: string, message: string): Response {
  return Response.json({ type: 'error', error: { type, message } }, { status, headers: RETRY_NOW })
}

interface StubDocument {
  type: 'document'
  source: { type: string; content: { type: string; text: string }[] }
  citations?: { enabled: boolean }
}

function headersOrModelProblem(request: Request, body: Record<string, unknown>): string | null {
  if (request.headers.get('anthropic-version') !== '2026-10-21') return 'anthropic-version'
  if (!(request.headers.get('anthropic-beta') ?? '').split(',').includes('server-side-fallback-2026-07-01'))
    return 'beta header'
  if (!['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'].includes(String(body.model))) return 'model'
  return null
}

function shapeProblem(request: Request, body: Record<string, unknown>): string | null {
  const shared = headersOrModelProblem(request, body)
  if (shared) return shared
  if (body.stream !== true || body.max_tokens !== 16_000) return 'stream or max_tokens'
  if (JSON.stringify(body.thinking) !== '{"type":"adaptive"}') return 'thinking'
  if (JSON.stringify(body.output_config) !== '{"effort":"medium"}') return 'effort'
  if (body.fallbacks !== 'default') return 'fallbacks'
  if ('temperature' in body || 'top_p' in body || 'top_k' in body) return 'sampling parameters'
  const docs = documents(body)
  if (!docs.length || docs.some((d) => d.source.type !== 'content' || d.citations?.enabled !== true)) return 'documents'
  return null
}

function documents(body: Record<string, unknown>): StubDocument[] {
  const first = (body.messages as { content: unknown }[] | undefined)?.[0]?.content
  return Array.isArray(first) ? first.filter((b): b is StubDocument => b?.type === 'document') : []
}

type StubEvent = { type: string; [field: string]: unknown }

const lastContent = (body: Record<string, unknown>) =>
  (body.messages as { content: unknown }[] | undefined)?.at(-1)?.content

function quotedPassage(body: Record<string, unknown>): boolean {
  const last = lastContent(body)
  return typeof last === 'string' && last.includes('<passage>')
}

function sentHighlights(body: Record<string, unknown>): number | null {
  const last = lastContent(body)
  if (typeof last !== 'string' || !last.includes('<highlights>')) return null
  return last.match(/<highlight /g)?.length ?? 0
}

export function requestKind(body: Record<string, unknown>): string | null {
  const last = lastContent(body)
  if (typeof last !== 'string') return null
  return /<request kind="(\w+)">/.exec(last)?.[1] ?? null
}

export function readerPrompt(body: Record<string, unknown>): string | null {
  const last = lastContent(body)
  if (typeof last !== 'string') return null
  const instruction = /<reader-prompt>\n([\s\S]*?)\n<\/reader-prompt>/.exec(last)?.[1]
  return instruction === undefined ? null : [...instruction].slice(0, 40).join('')
}

const sse = (event: StubEvent) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`

const citationDelta = (index: number, documentIndex: number, blockIndex: number): StubEvent => ({
  type: 'content_block_delta',
  index,
  delta: {
    type: 'citations_delta',
    citation: {
      type: 'content_block_location',
      cited_text: 'stub',
      document_index: documentIndex,
      document_title: 'stub',
      start_block_index: blockIndex,
      end_block_index: blockIndex + 1,
    },
  },
})

function answerEvents(
  model: string,
  docs: StubDocument[],
  ending: string,
  quoted: boolean,
  highlights: number | null,
  kind: string | null,
  prompt: string | null = null,
): StubEvent[] {
  const pages = docs.flatMap((d) => d.source.content).filter((b) => HEADING.test(b.text)).length
  const last = docs.length - 1
  const lastBlock = (docs[last]?.source.content.length ?? 1) - 1
  const usage = { input_tokens: 120, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
  const start = {
    type: 'message_start',
    message: {
      id: 'msg_stub',
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      stop_details: null,
      usage,
    },
  }
  const text = (index: number, t: string) => ({
    type: 'content_block_delta',
    index,
    delta: { type: 'text_delta', text: t },
  })
  const block = (index: number) => ({
    type: 'content_block_start',
    index,
    content_block: { type: 'text', text: '', citations: null },
  })
  const stop = (index: number) => ({ type: 'content_block_stop', index })
  const end = (stop_reason: string, output_tokens: number) => [
    {
      type: 'message_delta',
      delta: { stop_reason, stop_sequence: null, stop_details: null },
      usage: { ...usage, output_tokens },
    },
    { type: 'message_stop' },
  ]
  if (ending === STUB_KEYS.refusal) return [start, ...end('refusal', 0)]
  const thinking = [
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'stub' } },
    stop(0),
  ]
  if ((kind === 'quiz' || kind === 'flashcards') && ending !== STUB_KEYS.badFormat) {
    return [start, ...thinking, ...studyBlocks(kind, last, lastBlock, block, text, stop), ...end('end_turn', 900)]
  }
  const marked = highlights === null ? '' : ` and ${highlights} of your highlights`
  const request = (kind ? ` Request: ${kind}.` : '') + (prompt === null ? '' : ` Prompt: ${prompt}.`)
  const seen = `I can see ${pages} pages of the book${quoted ? ' and the passage you selected' : ''}${marked}.${request} `
  const opening = [block(1), text(1, seen), stop(1)]
  if (ending === STUB_KEYS.midStreamError) {
    return [
      start,
      ...thinking,
      ...opening,
      { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
    ]
  }
  const cited = [block(2), citationDelta(2, last, lastBlock), text(2, 'Your page says so'), stop(2)]
  const words =
    ending === STUB_KEYS.slow
      ? Array.from({ length: 40 }, (_, i) => text(3, `word${i} `))
      : [text(3, '.\n\nFor example:\n\n```js\nconst answer = 42\n```')]
  return [start, ...thinking, ...opening, ...cited, block(3), ...words, stop(3), ...end('end_turn', 64)]
}

function studyBlocks(
  kind: 'quiz' | 'flashcards',
  documentIndex: number,
  blockIndex: number,
  block: (index: number) => StubEvent,
  text: (index: number, t: string) => StubEvent,
  stop: (index: number) => StubEvent,
): StubEvent[] {
  const count = kind === 'quiz' ? 5 : 8
  const out: StubEvent[] = []
  let index = 1
  for (let n = 1; n <= count; n++) {
    const head =
      kind === 'quiz'
        ? `${n === 1 ? 'Here is your quiz.\n\n' : '\n\n'}QUESTION: What does stub question ${n} ask?\nA) ${STUB_RIGHT_ANSWER}\nB) A wrong answer ${n}a\nC) A wrong answer ${n}b\nD) A wrong answer ${n}c\nANSWER: A\nWHY: `
        : `${n === 1 ? '' : '\n\n'}FRONT: Stub card ${n}: what does the page say?\nBACK: `
    out.push(block(index), text(index, head), stop(index))
    index++
    out.push(
      block(index),
      citationDelta(index, documentIndex, blockIndex),
      text(index, kind === 'quiz' ? `The page says so (${n})` : `What the page says (${n})`),
      stop(index),
    )
    index++
    out.push(block(index), text(index, '.'), stop(index))
    index++
  }
  return out
}

function streamResponse(events: StubEvent[], delayMs: number, signal: AbortSignal): Response {
  const encoder = new TextEncoder()
  let stopped = false
  const stop = () => {
    if (stopped) return false
    stopped = true
    stats.aborted++
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

export function translationAsk(body: Record<string, unknown>): { to: string; text: string; context: string | null } {
  const content = String((body.messages as { content: unknown }[] | undefined)?.[0]?.content ?? '')
  const unescaped = (t: string) => t.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')
  const part = (tag: 'text' | 'context') =>
    (tag === 'text' ? /<text>\n([\s\S]*?)\n<\/text>/ : /<context>\n([\s\S]*?)\n<\/context>/).exec(content)?.[1]
  const context = part('context')
  return {
    to: / \(([\w-]+)\)\. If it is a single word/.exec(String(body.system))?.[1] ?? '',
    text: unescaped(part('text') ?? ''),
    context: context === undefined ? null : unescaped(context),
  }
}

function translationProblem(request: Request, body: Record<string, unknown>): string | null {
  const shared = headersOrModelProblem(request, body)
  if (shared) return shared
  if (body.stream === true || body.max_tokens !== 1_000) return 'stream or max_tokens'
  if (JSON.stringify(body.thinking) !== '{"type":"adaptive"}') return 'thinking'
  if (JSON.stringify(body.output_config) !== '{"effort":"low"}') return 'effort'
  if (body.fallbacks !== 'default') return 'fallbacks'
  const messages = body.messages as { role: string; content: unknown }[] | undefined
  if (messages?.length !== 1 || typeof messages[0]?.content !== 'string') return 'messages'
  const { to, text } = translationAsk(body)
  if (!to || !text) return 'text or target'
  return null
}

async function translation(request: Request, body: Record<string, unknown>, ending: string): Promise<Response> {
  if (ending === STUB_KEYS.slow) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 35_000)
      request.signal.addEventListener('abort', () => {
        clearTimeout(timer)
        stats.aborted++
        reject(new DOMException('The connection was closed', 'AbortError'))
      })
    })
  }
  const { to, text, context } = translationAsk(body)
  const sense = context ? `\nSense: ${context.split(/\s+/)[0]}` : ''
  const refused = ending === STUB_KEYS.refusal
  return Response.json({
    id: 'msg_stub',
    type: 'message',
    role: 'assistant',
    model: String(body.model),
    content: refused ? [] : [{ type: 'text', text: `[${to}] ${text}${sense}`, citations: null }],
    stop_reason: refused ? 'refusal' : 'end_turn',
    stop_sequence: null,
    stop_details: null,
    usage: {
      input_tokens: 90,
      output_tokens: refused ? 0 : 12,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  })
}

async function messages(request: Request): Promise<Response> {
  const key = keyOf(request)
  if (!key.startsWith('sk-ant-test-valid')) return apiError(401, 'authentication_error', 'invalid x-api-key')
  const ending = Object.values(STUB_KEYS).find((e) => key.endsWith(e)) ?? ''
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return apiError(400, 'invalid_request_error', 'body is not JSON')
  const translating = String(body.system).startsWith('You translate text from a book')
  const problem = translating ? translationProblem(request, body) : shapeProblem(request, body)
  if (problem) return apiError(400, 'invalid_request_error', `stub: unexpected request shape (${problem})`)
  switch (ending) {
    case STUB_KEYS.rejected:
      return apiError(401, 'authentication_error', 'invalid x-api-key')
    case STUB_KEYS.billing:
      return apiError(402, 'billing_error', 'credit balance too low')
    case STUB_KEYS.overloaded:
      return apiError(529, 'overloaded_error', 'Overloaded')
    case STUB_KEYS.rateLimited:
      return apiError(429, 'rate_limit_error', 'rate limited')
    case STUB_KEYS.tooLong:
      return apiError(400, 'invalid_request_error', 'prompt is too long: 1200000 tokens > 1000000 maximum')
  }
  if (translating) return translation(request, body, ending)
  return streamResponse(
    answerEvents(
      String(body.model),
      documents(body),
      ending,
      quotedPassage(body),
      sentHighlights(body),
      requestKind(body),
      readerPrompt(body),
    ),
    ending === STUB_KEYS.slow ? 150 : 0,
    request.signal,
  )
}

export async function anthropicStub(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname
  const key = keyOf(request)
  if (path.endsWith('/v1/models')) {
    return key.startsWith('sk-ant-test-valid')
      ? Response.json({ data: [], has_more: false })
      : Response.json({ type: 'error', error: { type: 'authentication_error' } }, { status: 401 })
  }
  if (path.endsWith('/v1/messages') && request.method === 'POST') return messages(request)
  if (path.endsWith('/stats')) return Response.json(stats)
  return new Response('not found', { status: 404 })
}
