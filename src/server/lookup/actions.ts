import '@tanstack/react-start/server-only'
import { type AiModelId, type AiProvider, isAiModel, providerOf } from '../../shared/lib/ai-models.ts'
import type { TranslateErrorCode, WordAnswer, WordErrorCode } from '../../shared/lookup/contract.ts'
import { primaryLanguage } from '../../shared/lookup/languages.ts'
import { hasKey } from '../api-keys.ts'
import { noStoreJson, requestIp } from '../auth.ts'
import { openTextBook } from '../books/book.ts'
import type { Db } from '../db.ts'
import { take } from '../quota.ts'
import { signedInEndpoints } from '../signed-in.ts'
import { getAiModel } from '../users.ts'
import { parseTranslateInput, parseWordInput } from './input.ts'
import { runOpenAiTranslation, runTranslation, type TranslateJob } from './translate.ts'
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
  const book = await openTextBook(db, userId, slug)
  return book && { title: book.title, lang: primaryLanguage(book.language) }
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
    const taken = await take(db, userId, 'word-lookup', {
      ip: requestIp(request),
      detail: { book: input.book, source: input.source },
    })
    if (!taken.ok) return fail(429, 'rate', { retryAt: taken.retryAt.toISOString() })

    const wikimedia: WikimediaOptions = { fetch: options.fetch, signal: request.signal }
    const found =
      input.source === 'dictionary'
        ? await dictionaryAnswer(input.term, book.lang, wikimedia)
        : await wikipediaAnswer(input.term, book.lang, wikimedia)
    const outcome: Outcome = found.ok ? found.value.answer.state : found.problem
    const retried = found.ok && found.value.retried

    await taken.settle({ outcome, retried })
    if (!found.ok) return found.problem === 'busy' ? fail(503, 'busy') : fail(502, 'unavailable')
    return noStoreJson(200, found.value.answer)
  })

const TRANSLATORS: Record<AiProvider, typeof runTranslation> = {
  anthropic: runTranslation,
  openai: runOpenAiTranslation,
}

/** The model to credit: Claude's as served, which may be a fallback; GPT's as chosen, not its dated snapshot. */
const CREDITED: Record<AiProvider, (servedBy: string | null, model: AiModelId) => string> = {
  anthropic: (servedBy, model) => servedBy ?? model,
  openai: (servedBy, model) => (isAiModel(servedBy) ? servedBy : model),
}

export const handleTranslate = (request: Request, options: LookupOptions = {}) =>
  lookups.post(
    request,
    {
      log: 'translate',
      body: { json: TRANSLATE_BODY_BYTES },
      parse: parseTranslateInput,
    },
    async ({ session, db, input }) => {
      const { userId } = session
      const book = await lookupBook(db, userId, input.book)
      if (!book) return fail(404, 'not_found')
      const model = await getAiModel(db, userId)
      const provider = providerOf(model)
      if (!(await hasKey(db, userId, provider))) return fail(409, 'no_key')
      const taken = await take(db, userId, 'translate', {
        ip: requestIp(request),
        detail: { book: input.book, kind: input.kind, to: input.to, model, provider },
      })
      if (!taken.ok) return fail(429, 'rate', { retryAt: taken.retryAt.toISOString() })

      const job: TranslateJob = {
        text: input.text,
        context: input.context,
        to: input.to,
        bookTitle: book.title,
        bookLang: book.lang,
        model,
      }
      const result = await TRANSLATORS[provider](db, userId, job, { signal: request.signal, fetch: options.fetch })
      await taken.settle({
        servedBy: result.servedBy,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        error: result.ok ? null : result.code,
      })
      if (result.ok)
        return noStoreJson(200, { translation: result.translation, model: CREDITED[provider](result.servedBy, model) })
      if (result.code === 'busy') return fail(503, 'busy')
      return fail(502, result.code === 'stopped' ? 'failed' : result.code)
    },
  )
