import { type StubEvent, sseResponse } from './sse-stub.ts'

/** Key endings that make the stub fail, or answer, in a given way. Valid keys start with OPENAI_VALID_PREFIX. */
export const STUB_OPENAI_KEYS = {
  rejected: 'reject',
  billing: 'nobill',
  rateLimited: 'limit',
  down: 'down',
  tooLong: 'toolong',
  refusal: 'refuse',
  midStreamError: 'break',
  failedResponse: 'failed',
  slow: 'slow',
} as const

export const OPENAI_VALID_PREFIX = 'sk-test-openai-valid'

export const openAiKey = (ending = '') => `${OPENAI_VALID_PREFIX}-xxxxxxxxxxxxxxxx${ending || '0000'}`

const GPT_MODELS = ['gpt-6.2-astra', 'gpt-6.1-terra', 'gpt-6-luna']

const stats = { aborted: 0, asked: 0 }

const keyOf = (request: Request) => /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1] ?? ''

const RETRY_NOW = { 'retry-after-ms': '0', 'retry-after': '0' }

function apiError(status: number, type: string, code: string | null, message: string): Response {
  return Response.json({ error: { type, code, message, param: null } }, { status, headers: RETRY_NOW })
}

type Body = Record<string, unknown>
type Input = { role: string; content: unknown }[]

const inputOf = (body: Body) => (Array.isArray(body.input) ? (body.input as Input) : [])

function askProblem(request: Request, body: Body): string | null {
  if (request.headers.has('openai-organization') || request.headers.has('openai-project')) return 'org or project'
  if (!GPT_MODELS.includes(String(body.model))) return 'model'
  if (body.stream !== true || body.max_output_tokens !== 16_000) return 'stream or max_output_tokens'
  if (JSON.stringify(body.reasoning) !== '{"effort":"medium"}') return 'reasoning'
  if (body.store !== false) return 'store'
  if (typeof body.instructions !== 'string' || !body.instructions.startsWith('You answer a reader'))
    return 'instructions'
  if ('temperature' in body || 'top_p' in body || 'tools' in body) return 'sampling or tools'
  const input = inputOf(body)
  const first = input[0]?.content
  if (typeof first !== 'string' || !first.startsWith('<document title="')) return 'documents'
  if (input.some((m) => typeof m.content !== 'string')) return 'input content'
  return null
}

function translateProblem(request: Request, body: Body): string | null {
  if (request.headers.has('openai-organization') || request.headers.has('openai-project')) return 'org or project'
  if (!GPT_MODELS.includes(String(body.model))) return 'model'
  if (body.stream === true || body.max_output_tokens !== 4_000) return 'stream or max_output_tokens'
  if (JSON.stringify(body.reasoning) !== '{"effort":"low"}') return 'reasoning'
  if (body.store !== false) return 'store'
  const input = inputOf(body)
  if (input.length !== 1 || typeof input[0]?.content !== 'string') return 'input'
  if (!/<text>\n[\s\S]+\n<\/text>/.test(input[0].content)) return 'text'
  return null
}

const lastText = (body: Body) => {
  const last = inputOf(body).at(-1)?.content
  return typeof last === 'string' ? last : ''
}

function seenLine(body: Body): string {
  const first = String(inputOf(body)[0]?.content ?? '')
  const pages = first.match(/(?:^|\n)(Chapter \d+: [^\n]+, page \d+|Page \d+)\n\n/g)?.length ?? 0
  const last = lastText(body)
  const quoted = last.includes('<passage>') ? ' and the passage you selected' : ''
  const highlights = last.includes('<highlights>')
    ? ` and ${last.match(/<highlight /g)?.length ?? 0} of your highlights`
    : ''
  const kind = /<request kind="(\w+)">/.exec(last)?.[1]
  const prompt = /<reader-prompt>\n([\s\S]*?)\n<\/reader-prompt>/.exec(last)?.[1]
  const request =
    (kind ? ` Request: ${kind}.` : '') + (prompt === undefined ? '' : ` Prompt: ${[...prompt].slice(0, 40).join('')}.`)
  return `GPT can see ${pages} pages of the book${quoted}${highlights}.${request} `
}

const usage = (output: number) => ({
  input_tokens: 1_200,
  input_tokens_details: { cached_tokens: 1_000, cache_write_tokens: 0 },
  output_tokens: output,
  output_tokens_details: { reasoning_tokens: 0 },
  total_tokens: 1_200 + output,
})

function responseBody(model: string, status: string, fields: Record<string, unknown> = {}) {
  return {
    id: 'resp_stub',
    object: 'response',
    created_at: 1_790_000_000,
    model: `${model}-2026-10-01`,
    status,
    error: null,
    incomplete_details: null,
    output: [],
    usage: null,
    ...fields,
  }
}

function answerEvents(body: Body, ending: string): StubEvent[] {
  const model = String(body.model)
  let n = 0
  const at = () => ({ sequence_number: n++ })
  const created = { type: 'response.created', response: responseBody(model, 'in_progress'), ...at() }
  const item = { type: 'message', id: 'msg_stub', role: 'assistant', status: 'in_progress', content: [] }
  const started = [
    { type: 'response.output_item.added', output_index: 0, item, ...at() },
    {
      type: 'response.content_part.added',
      item_id: 'msg_stub',
      output_index: 0,
      content_index: 0,
      part: { type: 'output_text', text: '', annotations: [] },
      ...at(),
    },
  ]
  const delta = (text: string) => ({
    type: 'response.output_text.delta',
    item_id: 'msg_stub',
    output_index: 0,
    content_index: 0,
    delta: text,
    logprobs: [],
    ...at(),
  })
  if (ending === STUB_OPENAI_KEYS.refusal) {
    return [
      created,
      {
        type: 'response.refusal.delta',
        item_id: 'msg_stub',
        output_index: 0,
        content_index: 0,
        delta: 'I can’t help with that.',
        ...at(),
      },
      { type: 'response.completed', response: responseBody(model, 'completed', { usage: usage(8) }), ...at() },
    ]
  }
  const seen = delta(seenLine(body))
  if (ending === STUB_OPENAI_KEYS.midStreamError)
    return [
      created,
      ...started,
      seen,
      { type: 'error', code: 'server_error', message: 'The server had an error', param: null, ...at() },
    ]
  if (ending === STUB_OPENAI_KEYS.failedResponse)
    return [
      created,
      ...started,
      seen,
      {
        type: 'response.failed',
        response: responseBody(model, 'failed', { error: { code: 'invalid_prompt', message: 'stub failure' } }),
        ...at(),
      },
    ]
  const words =
    ending === STUB_OPENAI_KEYS.slow
      ? Array.from({ length: 40 }, (_, i) => delta(`word${i} `))
      : [delta('Your page says so, on chapter 1.\n\nFor example:\n\n```js\nconst answer = 42\n```')]
  return [
    created,
    ...started,
    seen,
    ...words,
    { type: 'response.completed', response: responseBody(model, 'completed', { usage: usage(64) }), ...at() },
  ]
}

function openAiTranslationAsk(body: Body): { to: string; text: string; context: string | null } {
  const content = String(inputOf(body)[0]?.content ?? '')
  const unescaped = (t: string) => t.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')
  const text = /<text>\n([\s\S]*?)\n<\/text>/.exec(content)?.[1]
  const context = /<context>\n([\s\S]*?)\n<\/context>/.exec(content)?.[1]
  return {
    to: / \(([\w-]+)\)\. If it is a single word/.exec(String(body.instructions))?.[1] ?? '',
    text: unescaped(text ?? ''),
    context: context === undefined ? null : unescaped(context),
  }
}

function translation(body: Body, ending: string): Response {
  const { to, text, context } = openAiTranslationAsk(body)
  const sense = context ? `\nSense: ${context.split(/\s+/)[0]}` : ''
  const content =
    ending === STUB_OPENAI_KEYS.refusal
      ? [{ type: 'refusal', refusal: 'I can’t help with that.' }]
      : [{ type: 'output_text', text: `[${to}] ${text}${sense}`, annotations: [] }]
  return Response.json(
    responseBody(String(body.model), 'completed', {
      output: [
        { type: 'reasoning', id: 'rs_stub', summary: [] },
        { type: 'message', id: 'msg_stub', role: 'assistant', status: 'completed', content },
      ],
      usage: { ...usage(12), input_tokens: 90, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } },
    }),
  )
}

async function responses(request: Request): Promise<Response> {
  const key = keyOf(request)
  if (!key.startsWith(OPENAI_VALID_PREFIX))
    return apiError(401, 'invalid_request_error', 'invalid_api_key', 'Incorrect API key provided.')
  const ending = Object.values(STUB_OPENAI_KEYS).find((e) => key.endsWith(e)) ?? ''
  const body = (await request.json().catch(() => null)) as Body | null
  if (!body) return apiError(400, 'invalid_request_error', null, 'body is not JSON')
  const translating = String(body.instructions).startsWith('You translate text from a book')
  const problem = translating ? translateProblem(request, body) : askProblem(request, body)
  if (problem) return apiError(400, 'invalid_request_error', null, `stub: unexpected request shape (${problem})`)
  stats.asked++
  switch (ending) {
    case STUB_OPENAI_KEYS.rejected:
      return apiError(401, 'invalid_request_error', 'invalid_api_key', 'Incorrect API key provided.')
    case STUB_OPENAI_KEYS.billing:
      return apiError(429, 'insufficient_quota', 'insufficient_quota', 'You exceeded your current quota.')
    case STUB_OPENAI_KEYS.rateLimited:
      return apiError(429, 'requests', 'rate_limit_exceeded', 'Rate limit reached.')
    case STUB_OPENAI_KEYS.down:
      return apiError(503, 'server_error', null, 'The server is overloaded.')
    case STUB_OPENAI_KEYS.tooLong:
      return apiError(
        400,
        'invalid_request_error',
        'context_length_exceeded',
        'Your input exceeds the context window of this model.',
      )
  }
  if (translating) return translation(body, ending)
  return sseResponse(
    answerEvents(body, ending),
    ending === STUB_OPENAI_KEYS.slow ? 150 : 0,
    request.signal,
    () => stats.aborted++,
  )
}

export async function openAiStub(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname
  if (path.endsWith('/v1/models') && request.method === 'GET') {
    const key = keyOf(request)
    if (key.endsWith(STUB_OPENAI_KEYS.down)) return apiError(503, 'server_error', null, 'down')
    return key.startsWith(OPENAI_VALID_PREFIX)
      ? Response.json({ object: 'list', data: [] })
      : apiError(401, 'invalid_request_error', 'invalid_api_key', 'Incorrect API key provided.')
  }
  if (path.endsWith('/v1/responses') && request.method === 'POST') return responses(request)
  if (path.endsWith('/stats')) return Response.json(stats)
  return new Response('not found', { status: 404 })
}
