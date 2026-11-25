import '@tanstack/react-start/server-only'
import type Anthropic from '@anthropic-ai/sdk'
import type OpenAI from 'openai'
import type { BookContent } from '~/shared/content/schema'
import { type AiModelId, type AiProvider, canStudyWith, providerOf } from '~/shared/lib/ai-models'
import { anthropicClient } from '../anthropic.ts'
import { hasKey, withApiKey } from '../api-keys.ts'
import { findPrompt } from '../ask-prompts/store.ts'
import { NO_STORE, requestIp } from '../auth.ts'
import { openTextBook, type TextBook } from '../books/book.ts'
import { getConfig } from '../config.ts'
import type { Db } from '../db.ts'
import { resolvedHighlights } from '../highlights/resolve.ts'
import { OpenAiResponseError, openAiClient, openAiErrorCode } from '../openai.ts'
import { requirePro } from '../plans/plan.ts'
import { take } from '../quota.ts'
import { logError } from '../redact.ts'
import { type Gate, signedInEndpoints } from '../signed-in.ts'
import { getAiModel } from '../users.ts'
import { type BookText, bookText } from './book-text.ts'
import {
  type AskHighlight,
  askMessages,
  type BookContext,
  buildContext,
  describePosition,
  highlightsForAsk,
  OPENAI_SYSTEM_PROMPT,
  pageIndexAt,
  positionAt,
  STUDY_MIN_CHARS,
  type StudyScope,
  SYSTEM_PROMPT,
  studyScope,
} from './context.ts'
import { type AskAction, isStudyAction, parseAskInput } from './input.ts'
import { openAiEventMapper, openAiInput, openAiUsage } from './openai-stream.ts'
import { type AskErrorCode, type AskEvent, askErrorCode, encodeEvent, eventMapper, studyEvent } from './stream.ts'
import type { StudyBlock } from './study-format.ts'

const MAX_BODY_BYTES = 128 * 1024
const MAX_TOKENS = 16_000
const FALLBACK_BETA = 'server-side-fallback-2026-07-01'
const OPENAI_TIMEOUT_MS = 10 * 60_000

export type AskRefusal =
  | 'signed_out'
  | 'not_found'
  | 'no_prompt'
  | 'invalid'
  | 'too_little'
  | 'no_key'
  | 'needs_claude'
  | 'limit'
  | 'too_long'
  | 'failed'

const asks = signedInEndpoints<AskRefusal>({ maxBytes: MAX_BODY_BYTES })
const { fail: refuse } = asks

type AskParams = Omit<Anthropic.Beta.Messages.MessageCreateParamsStreaming, 'stream'>
type OpenAiAskParams = Omit<OpenAI.Responses.ResponseCreateParamsStreaming, 'stream'>

type AskRequest = { provider: 'anthropic'; params: AskParams } | { provider: 'openai'; params: OpenAiAskParams }

/** Each provider's request for the same messages: Claude reads the book as cited documents, GPT as plain text. */
const ASK_REQUESTS: { [P in AiProvider]: (model: AiModelId, messages: AskMessages) => AskRequest & { provider: P } } = {
  anthropic: (model, messages) => ({
    provider: 'anthropic',
    params: {
      model,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      messages,
    },
  }),
  openai: (model, messages) => ({
    provider: 'openai',
    params: {
      model,
      max_output_tokens: MAX_TOKENS,
      instructions: OPENAI_SYSTEM_PROMPT,
      reasoning: { effort: 'medium' },
      store: false,
      input: openAiInput(messages),
    },
  }),
}

type AskMessages = ReturnType<typeof askMessages>

const texts = new WeakMap<BookContent, BookText>()

function textOf(content: BookContent): BookText {
  let text = texts.get(content)
  if (!text) {
    text = bookText(content)
    texts.set(content, text)
  }
  return text
}

async function readerHighlights(
  db: Db,
  userId: number,
  book: TextBook,
  text: BookText,
  pageIndex: number,
  wholeBook: boolean,
): Promise<AskHighlight[]> {
  const views = await resolvedHighlights(db, userId, book)
  const chapterIndex = text.pages[pageIndex]?.chapterIndex ?? 0
  return highlightsForAsk(views, { chapterIndex, pageIndex }, wholeBook)
}

export interface AskOptions {
  fetch?: typeof fetch
}

async function askedBook({ session, db }: Gate, slug: string) {
  const notPro = requirePro(session, 'ask')
  if (notPro) return notPro
  const found = await openTextBook(db, session.userId, slug)
  if (!found) return refuse(404, 'not_found')
  return { found, text: textOf(await found.content()) }
}

function parseQuestion(value: unknown, book: { text: BookText }) {
  const input = parseAskInput(value)
  const pageIndex = input && pageIndexAt(book.text, input.position)
  return input && pageIndex !== null ? { input, pageIndex } : null
}

export const handleAsk = (request: Request, slug: string, options: AskOptions = {}) =>
  asks.post(
    request,
    { log: 'ask', before: (gate) => askedBook(gate, slug), parse: parseQuestion },
    async ({ session, db, pre: { found, text }, input: { input, pageIndex } }) => {
      const { userId } = session
      const prompt = input.prompt ? await findPrompt(db, userId, input.prompt) : null
      if (input.prompt && !prompt) return refuse(404, 'no_prompt')
      if (prompt && (prompt.appliesTo === 'passage') !== (input.quote !== null)) return refuse(400, 'invalid')
      const model = await getAiModel(db, userId)
      const provider = providerOf(model)
      if (isStudyAction(input.action) && !canStudyWith(model)) return refuse(409, 'needs_claude')
      const scope = isStudyAction(input.action) ? studyScope(text, pageIndex) : null
      if (scope && scope.chars < STUDY_MIN_CHARS) return refuse(422, 'too_little')

      if (!(await hasKey(db, userId, provider))) return refuse(409, 'no_key')

      const built = buildContext(text, pageIndex, { bookTitle: found.title, wholeBook: input.wholeBook })
      if (!built.ok) return refuse(413, 'too_long')
      const highlights = input.highlights
        ? await readerHighlights(db, userId, found, text, pageIndex, input.wholeBook)
        : []

      const ask = ASK_REQUESTS[provider](
        model,
        askMessages({
          context: built.context,
          wholeBook: input.wholeBook,
          where: describePosition(text, pageIndex),
          question: prompt ? prompt.name : input.question,
          quote: input.quote,
          history: input.history,
          highlights,
          action: input.action,
          scope,
          prompt: prompt && { instruction: prompt.instruction },
        }),
      )

      const action = prompt ? 'prompt' : input.action
      const taken = await take(db, userId, 'ask', {
        ip: requestIp(request),
        detail: {
          book: slug,
          model,
          provider,
          wholeBook: input.wholeBook,
          highlights: highlights.length,
          action,
          ...(input.spoken ? { spoken: true } : {}),
        },
      })
      if (!taken.ok) return refuse(429, 'limit', { retryAt: taken.retryAt.toISOString() })

      return answerResponse(request, {
        db,
        userId,
        settle: taken.settle,
        action,
        study: scope && {
          scope,
          sourceOf: (index: number | null) => {
            const at = index ?? pageIndex
            return { position: positionAt(text, at), label: text.pages[at]?.label ?? '' }
          },
        },
        request: ask,
        context: built.context,
        fetch: options.fetch,
      })
    },
  )

interface AnswerJob {
  db: Db
  userId: number
  /** Adds the outcome to this question's reservation. */
  settle: (detail: object) => Promise<void>
  action: AskAction | 'prompt' | null
  study: { scope: StudyScope; sourceOf: Parameters<typeof studyEvent>[3] } | null
  request: AskRequest
  context: BookContext
  signal: AbortSignal
  fetch: typeof fetch | undefined
  send: (event: AskEvent) => void
}

function answerResponse(request: Request, job: Omit<AnswerJob, 'signal' | 'send'>): Response {
  const upstream = new AbortController()
  request.signal?.addEventListener('abort', () => upstream.abort(), { once: true })
  const encoder = new TextEncoder()
  let open = true
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: AskEvent) => {
        if (!open) return
        try {
          controller.enqueue(encoder.encode(encodeEvent(event)))
        } catch {
          open = false
        }
      }
      void answer({ ...job, signal: upstream.signal, send }).finally(() => {
        if (!open) return
        open = false
        controller.close()
      })
    },
    cancel() {
      open = false
      upstream.abort()
    },
  })
  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': NO_STORE,
      'x-accel-buffering': 'no',
    },
  })
}

interface Meter {
  servedBy?: string
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
}

interface Answered {
  stop: string
  blocks: readonly StudyBlock[]
}

interface Runner<R extends AskRequest> {
  run: (job: AnswerJob, request: R, apiKey: string, meter: Meter) => Promise<Answered>
  errorCode: (error: unknown) => Exclude<AskErrorCode, 'bad_format'> | null
}

function meterClaude(meter: Meter, message: Anthropic.Beta.BetaMessage | undefined) {
  if (!message) return
  meter.servedBy = message.model
  meter.inputTokens = message.usage.input_tokens ?? 0
  meter.cacheReadTokens = message.usage.cache_read_input_tokens ?? 0
  meter.cacheWriteTokens = message.usage.cache_creation_input_tokens ?? 0
  meter.outputTokens = message.usage.output_tokens ?? 0
}

const claude: Runner<AskRequest & { provider: 'anthropic' }> = {
  async run(job, { params }, apiKey, meter) {
    const mapper = eventMapper(job.context, { collect: job.study !== null })
    const client = anthropicClient({ apiKey, apiBase: getConfig().anthropicApiBase, fetch: job.fetch })
    const stream = client.beta.messages.stream(params, { signal: job.signal })
    let message: Anthropic.Beta.BetaMessage
    try {
      for await (const event of stream) for (const out of mapper.map(event)) job.send(out)
      message = await stream.finalMessage()
    } finally {
      meterClaude(meter, stream.currentMessage)
    }
    meterClaude(meter, message)
    return { stop: message.stop_reason ?? mapper.stop ?? 'end_turn', blocks: mapper.blocks }
  },
  errorCode: askErrorCode,
}

const gpt: Runner<AskRequest & { provider: 'openai' }> = {
  async run(job, { params }, apiKey, meter) {
    const mapper = openAiEventMapper()
    const client = openAiClient({
      apiKey,
      apiBase: getConfig().openAiApiBase,
      timeoutMs: OPENAI_TIMEOUT_MS,
      fetch: job.fetch,
    })
    try {
      const stream = await client.responses.create({ ...params, stream: true }, { signal: job.signal })
      for await (const event of stream) for (const out of mapper.map(event)) job.send(out)
    } finally {
      const response = mapper.response
      if (response) Object.assign(meter, { servedBy: response.model }, openAiUsage(response.usage))
    }
    const stop = mapper.stop()
    if (stop === null) throw new OpenAiResponseError(null)
    return { stop, blocks: [] }
  },
  errorCode: openAiErrorCode,
}

const RUNNERS: { [P in AiProvider]: Runner<AskRequest & { provider: P }> } = { anthropic: claude, openai: gpt }

async function answer(job: AnswerJob): Promise<void> {
  const runner = RUNNERS[job.request.provider] as Runner<AskRequest>
  const meter: Meter = { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }
  let items: number | null = null
  let outcome: { stop: string } | { error: AskErrorCode | 'stopped' } | { stop: string; error: 'bad_format' }
  try {
    const { stop, blocks } = await withApiKey(
      job.userId,
      job.request.provider,
      (apiKey) => runner.run(job, job.request, apiKey, meter),
      job.db,
    )
    outcome = { stop }
    if (job.study && stop !== 'refusal') {
      const kind = job.action === 'quiz' ? 'quiz' : 'cards'
      const read = studyEvent(blocks, kind, job.study.scope.span, job.study.sourceOf)
      items = read.items
      job.send(read.event)
      if (read.items === null) outcome = { stop, error: 'bad_format' }
    }
    if (!('error' in outcome)) job.send({ type: 'done', stop })
  } catch (error) {
    const code = job.signal.aborted ? null : runner.errorCode(error)
    if (code === 'failed') logError('ask', error)
    if (code) job.send({ type: 'error', code })
    outcome = { error: code ?? 'stopped' }
  }
  try {
    await job.settle({
      servedBy: meter.servedBy ?? null,
      inputTokens: meter.inputTokens,
      cacheReadTokens: meter.cacheReadTokens,
      cacheWriteTokens: meter.cacheWriteTokens,
      outputTokens: meter.outputTokens,
      items,
      ...outcome,
    })
  } catch (error) {
    logError('ask audit', error)
  }
}
