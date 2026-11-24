import '@tanstack/react-start/server-only'
import type { TranslateErrorCode, WordAnswer, WordErrorCode } from '../../shared/lookup/contract.ts'
import { primaryLanguage } from '../../shared/lookup/languages.ts'
import { hasKey } from '../api-keys.ts'
import { eventTimes, recordEvent } from '../audit.ts'
import { noStoreJson, requestIp } from '../auth.ts'
import { openBook } from '../books/book.ts'
import type { Db } from '../db.ts'
import { requirePro } from '../plans/plan.ts'
import { type Limit, nextAllowedAt, TRANSLATE_LIMIT, WORD_LOOKUP_LIMIT } from '../rate-limit.ts'
import { signedInEndpoints } from '../signed-in.ts'
import { getAiModel } from '../users.ts'
import { parseTranslateInput, parseWordInput } from './input.ts'
import { runTranslation, translateRequest } from './translate.ts'
import {
  definition,
  summary,
  type WikimediaOptions,
  type WikimediaResult,
  wikipediaSearch,
  wiktionaryPage,
} from './wikimedia.ts'

const WORD_BODY_BYTES = 4 * 1024
const TRANSLATE_BODY_BYTES = 8 * 1024

const lookups = signedInEndpoints<WordErrorCode | TranslateErrorCode>({ maxBytes: WORD_BODY_BYTES })
const { fail } = lookups

interface LookupBook {
  title: string
  lang: string
}

async function lookupBook(db: Db, userId: number, slug: string): Promise<LookupBook | null> {
  const book = await openBook(db, userId, slug).then((b) => (b?.format === 'text' ? b : null))
  return book && { title: book.title, lang: primaryLanguage(book.language) }
}

async function retryAt(db: Db, userId: number, event: 'word.looked_up' | 'word.translated', limit: Limit) {
  const now = new Date()
  const times = await eventTimes(db, userId, [event], new Date(now.getTime() - limit.windowMs))
  return nextAllowedAt(times, limit, now)
}

export interface LookupOptions {
  fetch?: typeof fetch
}

type Outcome = 'found' | 'not-found' | 'ambiguous' | 'busy' | 'unavailable'

type Looked = WikimediaResult<{ answer: WordAnswer; retried: boolean }>

async function dictionaryAnswer(term: string, lang: string, wikimedia: WikimediaOptions): Promise<Looked> {
  const found = await definition(term, lang, wikimedia)
  if (!found.ok) return found
  const { entry, retried } = found.value
  const answer: WordAnswer = entry
    ? { state: 'found', source: 'dictionary', term: found.value.term, ...entry, url: wiktionaryPage(found.value.term) }
    : { state: 'not-found' }
  return { ok: true, value: { answer, retried } }
}

async function wikipediaAnswer(term: string, lang: string, wikimedia: WikimediaOptions): Promise<Looked> {
  const found = await summary(term, lang, wikimedia)
  if (!found.ok) return found
  const page = found.value
  let answer: WordAnswer
  if (!page) answer = { state: 'not-found', searchUrl: wikipediaSearch(term, lang) }
  else if (page.kind === 'ambiguous') answer = { state: 'ambiguous', title: page.title, url: page.url }
  else {
    const { kind: _kind, ...rest } = page
    answer = { state: 'found', source: 'wikipedia', ...rest }
  }
  return { ok: true, value: { answer, retried: false } }
}

export const handleWordLookup = (request: Request, options: LookupOptions = {}) =>
  lookups.post(request, { log: 'word lookup', parse: parseWordInput }, async ({ session, db, input }) => {
    const { userId } = session
    const book = await lookupBook(db, userId, input.book)
    if (!book) return fail(404, 'not_found')
    const wait = await retryAt(db, userId, 'word.looked_up', WORD_LOOKUP_LIMIT)
    if (wait) return fail(429, 'rate', { retryAt: wait.toISOString() })

    const wikimedia: WikimediaOptions = { fetch: options.fetch, signal: request.signal }
    const found =
      input.source === 'dictionary'
        ? await dictionaryAnswer(input.term, book.lang, wikimedia)
        : await wikipediaAnswer(input.term, book.lang, wikimedia)
    const outcome: Outcome = found.ok ? found.value.answer.state : found.problem
    const retried = found.ok && found.value.retried

    await recordEvent(db, 'word.looked_up', {
      userId,
      ip: requestIp(request),
      detail: { book: input.book, source: input.source, outcome, retried },
    })
    if (!found.ok) return found.problem === 'busy' ? fail(503, 'busy') : fail(502, 'unavailable')
    return noStoreJson(200, found.value.answer)
  })

export const handleTranslate = (request: Request, options: LookupOptions = {}) =>
  lookups.post(
    request,
    {
      log: 'translate',
      body: { json: TRANSLATE_BODY_BYTES },
      before: ({ session }) => requirePro(session, 'translate') ?? undefined,
      parse: parseTranslateInput,
    },
    async ({ session, db, input }) => {
      const { userId } = session
      const book = await lookupBook(db, userId, input.book)
      if (!book) return fail(404, 'not_found')
      if (!(await hasKey(db, userId, 'anthropic'))) return fail(409, 'no_key')
      const wait = await retryAt(db, userId, 'word.translated', TRANSLATE_LIMIT)
      if (wait) return fail(429, 'rate', { retryAt: wait.toISOString() })

      const model = await getAiModel(db, userId)
      const params = translateRequest({
        text: input.text,
        context: input.context,
        to: input.to,
        bookTitle: book.title,
        bookLang: book.lang,
        model,
      })
      const result = await runTranslation(db, userId, params, { signal: request.signal, fetch: options.fetch })
      await recordEvent(db, 'word.translated', {
        userId,
        ip: requestIp(request),
        detail: {
          book: input.book,
          kind: input.kind,
          to: input.to,
          model,
          servedBy: result.servedBy,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          error: result.ok ? null : result.code,
        },
      })
      if (result.ok) return noStoreJson(200, { translation: result.translation, model: result.servedBy ?? model })
      if (result.code === 'busy') return fail(503, 'busy')
      return fail(502, result.code === 'stopped' ? 'failed' : result.code)
    },
  )
