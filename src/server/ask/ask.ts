import '@tanstack/react-start/server-only'
import Anthropic from '@anthropic-ai/sdk'
import type { BookContent } from '~/shared/content/schema'
import type { AiModelId } from '~/shared/lib/ai-models'
import { ANTHROPIC_VERSION } from '../anthropic.ts'
import { hasKey, withApiKey } from '../api-keys.ts'
import { findPrompt } from '../ask-prompts/store.ts'
import { eventTimes, recordEvent } from '../audit.ts'
import { NO_STORE, requestIp } from '../auth.ts'
import { findBook, type TextBook } from '../book-ref/book.ts'
import { getConfig } from '../config.ts'
import type { Db } from '../db.ts'
import { resolvedHighlights } from '../highlights/resolve.ts'
import { requirePro } from '../plans/plan.ts'
import { ASK_LIMIT, nextAllowedAt } from '../rate-limit.ts'
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
  pageIndexAt,
  positionAt,
  STUDY_MIN_CHARS,
  type StudyScope,
  SYSTEM_PROMPT,
  studyScope,
} from './context.ts'
import { type AskAction, isStudyAction, parseAskInput } from './input.ts'
import { type AskErrorCode, type AskEvent, askErrorCode, encodeEvent, eventMapper, studyEvent } from './stream.ts'

const MAX_BODY_BYTES = 128 * 1024
const MAX_TOKENS = 16_000
const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

export type AskRefusal =
  | 'signed_out'
  | 'not_found'
  | 'no_prompt'
  | 'invalid'
  | 'too_little'
  | 'no_key'
  | 'limit'
  | 'too_long'
  | 'failed'

const asks = signedInEndpoints<AskRefusal>({ maxBytes: MAX_BODY_BYTES })
const { fail: refuse } = asks

type AskParams = Omit<Anthropic.Beta.Messages.MessageCreateParamsStreaming, 'stream'>

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
  const found = await findBook(db, session.userId, slug, 'text')
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
      const book = { title: found.title, text }
      const prompt = input.prompt ? await findPrompt(db, userId, input.prompt) : null
      if (input.prompt && !prompt) return refuse(404, 'no_prompt')
      if (prompt && (prompt.appliesTo === 'passage') !== (input.quote !== null)) return refuse(400, 'invalid')
      const scope = isStudyAction(input.action) ? studyScope(book.text, pageIndex) : null
      if (scope && scope.chars < STUDY_MIN_CHARS) return refuse(422, 'too_little')

      const now = new Date()
      const asked = await eventTimes(db, userId, ['book.asked'], new Date(now.getTime() - ASK_LIMIT.windowMs))
      const retryAt = nextAllowedAt(asked, ASK_LIMIT, now)
      if (retryAt) return refuse(429, 'limit', { retryAt: retryAt.toISOString() })

      if (!(await hasKey(db, userId, 'anthropic'))) return refuse(409, 'no_key')

      const built = buildContext(book.text, pageIndex, { bookTitle: book.title, wholeBook: input.wholeBook })
      if (!built.ok) return refuse(413, 'too_long')
      const model = await getAiModel(db, userId)
      const highlights = input.highlights
        ? await readerHighlights(db, userId, found, book.text, pageIndex, input.wholeBook)
        : []

      const params: AskParams = {
        model,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
        messages: askMessages({
          context: built.context,
          wholeBook: input.wholeBook,
          where: describePosition(book.text, pageIndex),
          question: prompt ? prompt.name : input.question,
          quote: input.quote,
          history: input.history,
          highlights,
          action: input.action,
          scope,
          prompt: prompt && { instruction: prompt.instruction },
        }),
      }

      return answerResponse(request, {
        db,
        userId,
        ip: requestIp(request),
        slug,
        model,
        wholeBook: input.wholeBook,
        highlights: highlights.length,
        action: prompt ? 'prompt' : input.action,
        spoken: input.spoken,
        study: scope && {
          scope,
          sourceOf: (index: number | null) => {
            const at = index ?? pageIndex
            return { position: positionAt(book.text, at), label: book.text.pages[at]?.label ?? '' }
          },
        },
        params,
        context: built.context,
        fetch: options.fetch,
      })
    },
  )

interface AnswerJob {
  db: Db
  userId: number
  ip: string | null
  slug: string
  model: AiModelId
  wholeBook: boolean
  highlights: number
  action: AskAction | 'prompt' | null
  spoken: boolean
  study: { scope: StudyScope; sourceOf: Parameters<typeof studyEvent>[3] } | null
  params: AskParams
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

async function answer(job: AnswerJob): Promise<void> {
  const mapper = eventMapper(job.context, { collect: job.study !== null })
  let usage: Anthropic.Beta.BetaUsage | undefined
  let servedBy: string | undefined
  let items: number | null = null
  let outcome: { stop: string } | { error: AskErrorCode | 'stopped' } | { stop: string; error: 'bad_format' }
  try {
    const message = await withApiKey(
      job.userId,
      'anthropic',
      async (apiKey) => {
        const client = new Anthropic({
          apiKey,
          baseURL: getConfig().anthropicApiBase,
          defaultHeaders: { 'anthropic-version': ANTHROPIC_VERSION },
          logLevel: 'off',
          openTelemetry: false,
          ...(job.fetch ? { fetch: job.fetch } : {}),
        })
        const stream = client.beta.messages.stream(job.params, { signal: job.signal })
        try {
          for await (const event of stream) for (const out of mapper.map(event)) job.send(out)
          return await stream.finalMessage()
        } finally {
          usage = stream.currentMessage?.usage
          servedBy = stream.currentMessage?.model
        }
      },
      job.db,
    )
    usage = message.usage
    servedBy = message.model
    const stop = message.stop_reason ?? mapper.stop ?? 'end_turn'
    outcome = { stop }
    if (job.study && stop !== 'refusal') {
      const kind = job.action === 'quiz' ? 'quiz' : 'cards'
      const read = studyEvent(mapper.blocks, kind, job.study.scope.span, job.study.sourceOf)
      items = read.items
      job.send(read.event)
      if (read.items === null) outcome = { stop, error: 'bad_format' }
    }
    if (!('error' in outcome)) job.send({ type: 'done', stop })
  } catch (error) {
    const code = job.signal.aborted ? null : askErrorCode(error)
    if (code === 'failed') logError('ask', error)
    if (code) job.send({ type: 'error', code })
    outcome = { error: code ?? 'stopped' }
  }
  try {
    await recordEvent(job.db, 'book.asked', {
      userId: job.userId,
      ip: job.ip,
      detail: {
        book: job.slug,
        model: job.model,
        servedBy: servedBy ?? null,
        inputTokens: usage?.input_tokens ?? 0,
        cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
        cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
        outputTokens: usage?.output_tokens ?? 0,
        wholeBook: job.wholeBook,
        highlights: job.highlights,
        action: job.action,
        ...(job.spoken ? { spoken: true } : {}),
        items,
        ...outcome,
      },
    })
  } catch (error) {
    logError('ask audit', error)
  }
}
