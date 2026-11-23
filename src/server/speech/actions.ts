import '@tanstack/react-start/server-only'
import { isBookSlug } from '../../shared/content/book-slug.ts'
import { canUse } from '../../shared/plans/plans.ts'
import { sayMap, wordsFrom } from '../../shared/read-aloud/alignment.ts'
import {
  primarySubtag,
  rankCloudVoices,
  type SpeakErrorCode,
  type SpeechFormat,
  type SpeechVoicesState,
} from '../../shared/read-aloud/cloud.ts'
import { CODE_SAY, chapterIntro, type Utterance, utterances } from '../../shared/read-aloud/sentences.ts'
import type { SpeechChapter } from '../../shared/read-aloud/speech-text.ts'
import { hasKey, withApiKey } from '../api-keys.ts'
import { noStoreJson } from '../auth.ts'
import { findBook } from '../book-ref/book.ts'
import type { Db } from '../db.ts'
import { requirePro } from '../plans/plan.ts'
import { charactersRetryAt, SPEECH_LIMIT } from '../rate-limit.ts'
import { logError } from '../redact.ts'
import { signedInEndpoints, signedInRead } from '../signed-in.ts'
import { getSpeechModel } from '../users.ts'
import { type ElevenLabsOptions, listVoices, type SpeechResult, synthesize } from './elevenlabs.ts'
import { parseSpeakInput, type SpeakInput } from './input.ts'
import { recordUsage, usageSince } from './store.ts'

const SPEAK_BODY_BYTES = 2 * 1024

const FORMAT_REFUSED = new Set([400, 403, 422])

const UPSTREAM_STATUS: Partial<Record<SpeakErrorCode, number>> = {
  key_rejected: 502,
  no_credits: 502,
  permission: 502,
  voice_gone: 404,
  busy: 503,
}

const speech = signedInEndpoints<SpeakErrorCode>({ maxBytes: SPEAK_BODY_BYTES })
const { fail } = speech

export interface SpeechOptions extends ElevenLabsOptions {
  now?: () => Date
}

interface LoadedChapter {
  language: string
  chapter: SpeechChapter
}

async function chapterFor(db: Db, userId: number, slug: string, index: number): Promise<LoadedChapter | null> {
  const book = await findBook(db, userId, slug, 'text')
  const chapter = await book?.chapter(index)
  return book && chapter ? { language: book.language, chapter } : null
}

const samePosition = (a: SpeakInput & { kind: 'span' }, page: SpeechChapter['pages'][number]) =>
  'printedPage' in a.position
    ? 'printedPage' in page.position && page.position.printedPage === a.position.printedPage
    : 'chapter' in page.position &&
      page.position.chapter === a.position.chapter &&
      page.position.page === a.position.page

interface Spoken {
  say: string
  previous: string
  next: string
  words: { text: string; start: number; end: number } | null
}

function around(list: readonly Utterance[], want: number, fromEnd: boolean): string {
  const picked: string[] = []
  let length = 0
  for (let i = 0; i < list.length && length < want; i++) {
    const u = list[fromEnd ? list.length - 1 - i : i]
    if (!u) break
    picked.push(u.say)
    length += u.say.length + 1
  }
  return (fromEnd ? picked.reverse() : picked).join(' ')
}

function spokenFor(input: SpeakInput, loaded: LoadedChapter): Spoken | null {
  const { chapter, language } = loaded
  const all = chapter.pages.flatMap((page, pageIndex) => utterances(page, language).map((u) => ({ u, pageIndex })))
  const flat = all.map((a) => a.u)
  const enough = 400
  if (input.kind === 'intro')
    return { say: chapterIntro(chapter), previous: '', next: around(flat, enough, false), words: null }
  const pageIndex = chapter.pages.findIndex((p) => samePosition(input, p))
  const page = chapter.pages[pageIndex]
  if (!page) return null
  const at = all.findIndex((a) => a.pageIndex === pageIndex && a.u.start === input.start && a.u.end === input.end)
  const u = all[at]?.u
  if (!u) return null
  return {
    say: u.say,
    previous: around(flat.slice(0, at), enough, true),
    next: around(flat.slice(at + 1), enough, false),
    words: u.kind === 'code' && u.say === CODE_SAY ? null : { text: page.text, start: u.start, end: u.end },
  }
}

export const handleSpeak = (request: Request, options: SpeechOptions = {}) =>
  speech.post(
    request,
    {
      log: 'read aloud speech',
      before: ({ session }) => requirePro(session, 'elevenlabs') ?? undefined,
      parse: parseSpeakInput,
    },
    async ({ session, db, input }) => {
      const { userId } = session
      const loaded = await chapterFor(db, userId, input.book, input.chapter)
      if (!loaded) return fail(404, 'not_found')
      const spoken = spokenFor(input, loaded)
      if (!spoken) return fail(400, 'invalid')
      if (!(await hasKey(db, userId, 'elevenlabs'))) return fail(409, 'no_key')
      const now = options.now?.() ?? new Date()
      const minutes = await usageSince(db, userId, new Date(now.getTime() - SPEECH_LIMIT.windowMs))
      const wait = charactersRetryAt(minutes, spoken.say.length, SPEECH_LIMIT, now)
      if (wait) return fail(429, 'rate', { retryAt: wait.toISOString() })

      const model = await getSpeechModel(db, userId)
      const job = (format: SpeechFormat) => ({
        voice: input.voice,
        model,
        text: spoken.say,
        previousText: spoken.previous,
        nextText: spoken.next,
        language: primarySubtag(loaded.language) || 'en',
        format,
      })
      const { result, format } = await withApiKey(
        userId,
        'elevenlabs',
        async (key): Promise<{ result: SpeechResult; format: SpeechFormat }> => {
          const first = await synthesize(key, job(input.format), request.signal, options)
          if (first.ok || input.format !== 'low' || !FORMAT_REFUSED.has(first.status))
            return { result: first, format: input.format }
          return { result: await synthesize(key, job('standard'), request.signal, options), format: 'standard' }
        },
        db,
      )
      if (!result.ok) {
        logError('read aloud speech', `ElevenLabs answered ${result.status} (${result.code})`)
        const status = UPSTREAM_STATUS[result.code]
        return status ? fail(status, result.code) : fail(502, 'failed')
      }
      await recordUsage(db, userId, spoken.say.length, now)
      const words = spoken.words
        ? wordsFrom(sayMap(spoken.words.text, spoken.words.start, spoken.words.end), result.alignment)
        : []
      return noStoreJson(200, { audio: result.audio, words, format })
    },
  )

async function bookLanguage(db: Db, userId: number, slug: string): Promise<string | null> {
  return (await findBook(db, userId, slug, 'text'))?.language ?? null
}

export function speechVoicesState(
  request: Request,
  book: string,
  options: ElevenLabsOptions = {},
): Promise<SpeechVoicesState> {
  return signedInRead(request, 'read aloud voices', async ({ session, db }): Promise<SpeechVoicesState> => {
    if (!canUse(session.plan, 'elevenlabs')) return { state: 'pro' }
    if (!isBookSlug(book)) return { state: 'not_found' }
    const language = await bookLanguage(db, session.userId, book)
    if (language === null) return { state: 'not_found' }
    if (!(await hasKey(db, session.userId, 'elevenlabs'))) return { state: 'no_key' }
    const listed = await withApiKey(session.userId, 'elevenlabs', (key) => listVoices(key, options), db)
    if (!listed.ok) {
      if (listed.code === 'unavailable') logError('read aloud voices', `ElevenLabs answered ${listed.status ?? 'none'}`)
      return { state: listed.code }
    }
    return {
      state: 'ready',
      voices: rankCloudVoices(listed.voices, language),
      model: await getSpeechModel(db, session.userId),
    }
  })
}
