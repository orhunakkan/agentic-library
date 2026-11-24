import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { privateBookSlug } from '~/shared/content/book-slug'
import { testUser } from '../testing/users'

vi.mock('~/server/repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/server/repository')>()
  return { ...actual, loadBook: vi.fn(actual.loadBook) }
})

import { saveKey } from '~/server/api-keys'
import { openBook } from '~/server/books/book'
import { getConfig } from '~/server/config'
import { closeDb, getDb } from '~/server/db'
import { loadBook } from '~/server/repository'
import { hashToken, newSessionToken } from '~/server/security'
import { createSession } from '~/server/sessions'
import { handleSpeak, speechVoicesState } from '~/server/speech/actions'
import { charactersSince, KEEP_DAYS, recordUsage, usageLast30Days, usageSince } from '~/server/speech/store'
import { finishImport, startImport, storeChapter } from '~/server/user-books'
import { setSpeechModel } from '~/server/users'
import { NO_DETAILS } from '~/shared/import/details'
import { chapterIntro, utterances } from '~/shared/read-aloud/sentences'
import type { SpeechChapter } from '~/shared/read-aloud/speech-text'
import {
  elevenLabsKey,
  elevenLabsStub,
  resetElevenLabsStub,
  STUB_ELEVENLABS_KEYS,
  stubSpeechRequests,
} from '../../../tests/e2e/support/elevenlabs-stub'
import { databaseUrl, freshDatabase } from '../testing/db'

const raw = postgres(databaseUrl, { max: 1, onnotice: () => {} })
const db = () => getDb()

beforeAll(freshDatabase)
afterAll(async () => {
  await raw.end()
  await closeDb()
})
beforeEach(async () => {
  await raw`truncate users, sessions, api_keys, audit_events, user_books, speech_usage restart identity cascade`
  resetElevenLabsStub()
})
afterEach(() => vi.restoreAllMocks())

const origin = getConfig().appOrigin
const cookieName = getConfig().cookieSecure ? '__Host-session' : 'session'
const BOOK = 'pride-and-prejudice'
const VOICE = 'StubVoiceAria01'

const calls: string[] = []
const stubFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  calls.push(url)
  return elevenLabsStub(new Request(url.replace('https://api.elevenlabs.io', 'http://stub/test-elevenlabs'), init))
}) as typeof fetch
beforeEach(() => {
  calls.length = 0
})

let users = 0
async function reader({ key = elevenLabsKey() as string | null } = {}) {
  const user = await testUser(db(), `reader-${++users}`, '$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA', 'member')
  const token = newSessionToken()
  await createSession(db(), { tokenHash: hashToken(token), userId: user.id, ip: null, userAgent: 'test' })
  if (key) await saveKey(db(), user.id, 'elevenlabs', key)
  return { user, cookie: `${cookieName}=${token}` }
}

async function privateBook(userId: number, ready = true) {
  const start = await startImport(db(), userId, {
    title: 'Carnet',
    author: 'Ada',
    language: 'en-GB',
    details: NO_DETAILS,
    chapterCount: 1,
  })
  if (!start.ok) throw new Error('could not start')
  if (ready) {
    await storeChapter(db(), userId, start.id, 0, {
      title: 'One',
      pages: ['<p>The first page ends here.</p>', '<p>The second page begins. It goes on.</p>'],
    })
    expect(await finishImport(db(), userId, start.id, null)).toBe('ok')
  }
  return privateBookSlug(start.id)
}

let chapter1: SpeechChapter
beforeAll(async () => {
  const book = await openBook(null, null, BOOK)
  const found = book?.format === 'text' ? await book.speechChapter(0) : null
  if (!found) throw new Error(`${BOOK} has no first chapter`)
  chapter1 = found.chapter
})

const said = (chapter: SpeechChapter, page: number) => utterances(chapter.pages[page] ?? { text: '', blocks: [] }, 'en')

function spanOf(n: number, page = 0, extra: Record<string, unknown> = {}) {
  const u = said(chapter1, page)[n]
  if (!u) throw new Error('no such utterance')
  return {
    book: BOOK,
    chapter: 0,
    voice: VOICE,
    position: chapter1.pages[page]?.position,
    start: u.start,
    end: u.end,
    ...extra,
  }
}

function post(cookie: string | null, payload: unknown, headers: Record<string, string> = {}) {
  return new Request(`${origin}/account/read-aloud/speak`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  })
}

const speak = (cookie: string | null, payload: unknown, headers: Record<string, string> = {}) =>
  handleSpeak(post(cookie, payload, headers), { fetch: stubFetch })

const usageRows = (userId: number) =>
  raw<{ characters: number; requests: number }[]>`
    select characters, requests from speech_usage where user_id = ${userId}`

const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => {})

describe('the usage store', () => {
  it('adds each generation to its minute, scoped to the user, and sums the last hour', async () => {
    const a = await reader()
    const b = await reader()
    const now = new Date('2026-11-07T12:00:30Z')
    await recordUsage(db(), a.user.id, 100, now)
    await recordUsage(db(), a.user.id, 50, new Date('2026-11-07T12:00:59Z'))
    await recordUsage(db(), a.user.id, 70, new Date('2026-11-07T11:30:00Z'))
    await recordUsage(db(), a.user.id, 999, new Date('2026-11-07T10:30:00Z'))
    await recordUsage(db(), b.user.id, 5, now)
    expect(
      await raw`select minute, characters, requests from speech_usage where user_id = ${a.user.id} order by minute`,
    ).toEqual([
      { minute: new Date('2026-11-07T10:30:00Z'), characters: 999, requests: 1 },
      { minute: new Date('2026-11-07T11:30:00Z'), characters: 70, requests: 1 },
      { minute: new Date('2026-11-07T12:00:00Z'), characters: 150, requests: 2 },
    ])
    const hourAgo = new Date(now.getTime() - 60 * 60_000)
    expect(await charactersSince(db(), a.user.id, hourAgo)).toBe(220)
    expect((await usageSince(db(), a.user.id, hourAgo)).map((m) => m.characters)).toEqual([70, 150])
    expect(await charactersSince(db(), b.user.id, hourAgo)).toBe(5)
    expect(await charactersSince(db(), 999_999, hourAgo)).toBe(0)
  })

  it('sweeps the user’s rows past 31 days when it records one, and counts 30 days for the page', async () => {
    const a = await reader()
    const b = await reader()
    const now = new Date()
    const days = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60_000)
    await raw`
      insert into speech_usage (user_id, minute, characters, requests) values
        (${a.user.id}, date_trunc('minute', ${days(KEEP_DAYS + 1)}::timestamptz), 1000, 1),
        (${a.user.id}, date_trunc('minute', ${days(30.5)}::timestamptz), 300, 1),
        (${a.user.id}, date_trunc('minute', ${days(2)}::timestamptz), 20, 1),
        (${b.user.id}, date_trunc('minute', ${days(KEEP_DAYS + 1)}::timestamptz), 7, 1)`
    await recordUsage(db(), a.user.id, 1, now)
    expect((await usageRows(a.user.id)).map((r) => r.characters).sort((x, y) => x - y)).toEqual([1, 20, 300])
    expect((await usageRows(b.user.id)).map((r) => r.characters)).toEqual([7])
    expect(await usageLast30Days(db(), a.user.id, now)).toBe(21)
  })

  it('goes when the user does', async () => {
    const a = await reader()
    await recordUsage(db(), a.user.id, 10)
    await raw`delete from users where id = ${a.user.id}`
    expect((await raw`select 1 from speech_usage`).count).toBe(0)
  })
})

describe('POST /account/read-aloud/speak', () => {
  it('refuses a signed-out reader', async () => {
    await reader()
    const signedOut = await speak(null, spanOf(0))
    expect([signedOut.status, await signedOut.json()]).toEqual([401, { error: 'signed_out' }])
    expect(signedOut.headers.get('cache-control')).toBe('private, no-store')
  })

  it('refuses a bad body', async () => {
    const { cookie } = await reader()
    expect((await speak(cookie, '{not json')).status).toBe(400)
    expect((await speak(cookie, { ...spanOf(0), text: 'Say this.' })).status).toBe(400)
    expect(calls).toEqual([])
  })

  it('refuses a span that isn’t one of the page’s utterances, and a page the chapter hasn’t', async () => {
    const { user, cookie } = await reader()
    const first = spanOf(0)
    for (const body of [
      { ...first, end: first.end - 1 },
      { ...first, start: first.start + 1 },
      { ...first, end: spanOf(1).end },
      { ...first, position: { chapter: 'chapter-1', page: 99 } },
      { ...first, position: { chapter: 'chapter-2', page: 1 } },
      { ...first, position: { printedPage: 1 } },
    ]) {
      const response = await speak(cookie, body)
      expect([response.status, await response.json()], JSON.stringify(body)).toEqual([400, { error: 'invalid' }])
    }
    expect(calls).toEqual([])
    expect(await usageRows(user.id)).toEqual([])
  })

  it('is a 404 for an unknown book or chapter, another reader’s private book and an unfinished one', async () => {
    const { user, cookie } = await reader()
    const other = await reader()
    const theirs = await privateBook(other.user.id)
    const unfinished = await privateBook(user.id, false)
    for (const body of [
      { ...spanOf(0), book: 'no-such-book' },
      { ...spanOf(0), chapter: 9999 },
      { book: theirs, chapter: 0, voice: VOICE, intro: true },
      { book: unfinished, chapter: 0, voice: VOICE, intro: true },
      { book: theirs, chapter: 5000, voice: VOICE, intro: true },
    ]) {
      const response = await speak(cookie, body)
      expect([response.status, await response.json()], JSON.stringify(body)).toEqual([404, { error: 'not_found' }])
    }
  })

  it('is a 409 without an ElevenLabs key, even with an Anthropic one', async () => {
    const { user, cookie } = await reader({ key: null })
    await saveKey(db(), user.id, 'anthropic', 'sk-ant-test-valid-xxxxxxxxxxxxxxxx0000')
    const response = await speak(cookie, spanOf(0))
    expect([response.status, await response.json()]).toEqual([409, { error: 'no_key' }])
    expect(calls).toEqual([])
  })

  it('is a 429 with retryAt once the hour’s 150,000 characters are used', async () => {
    const { user, cookie } = await reader()
    await raw`
      insert into speech_usage (user_id, minute, characters, requests)
      values (${user.id}, date_trunc('minute', now()), 150000, 750)`
    const response = await speak(cookie, spanOf(0))
    expect(response.status).toBe(429)
    const body = await response.json()
    expect(body.error).toBe('rate')
    expect(new Date(body.retryAt).getTime()).toBeGreaterThan(Date.now() + 59 * 60_000)
    expect(calls).toEqual([])
  })

  it('speaks the page’s own text with its neighbours, answers the audio and words, and counts the characters', async () => {
    const { user, cookie } = await reader()
    await setSpeechModel(db(), user.id, 'eleven_v4')
    const u = said(chapter1, 0)[1]
    const response = await speak(cookie, spanOf(1))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const answer = await response.json()
    expect(Object.keys(answer)).toEqual(['audio', 'words', 'format'])
    expect(answer.format).toBe('low')
    expect(Buffer.from(answer.audio, 'base64').subarray(0, 2)).toEqual(Buffer.from([0xff, 0xfb]))
    const text = chapter1.pages[0]?.text ?? ''
    const words = answer.words as { start: number; end: number; t0: number; t1: number }[]
    expect(words.map((w) => text.slice(w.start, w.end)).join(' ')).toBe(u?.say)
    expect(words[0]?.t0).toBe(0)
    expect(words.at(-1)?.t1).toBe(1000)

    const [sent] = stubSpeechRequests()
    expect(sent).toMatchObject({ voice: VOICE, format: 'mp3_44100_64' })
    expect(sent?.body).toMatchObject({ text: u?.say, model_id: 'eleven_v4', language_code: 'en' })
    expect(sent?.body.previous_text).toBe(said(chapter1, 0)[0]?.say)
    expect(String(sent?.body.next_text).startsWith(said(chapter1, 0)[2]?.say ?? 'none')).toBe(true)
    expect(await usageRows(user.id)).toEqual([{ characters: u?.say.length, requests: 1 }])
    const [key] = await raw<
      { last_used_at: Date | null }[]
    >`select last_used_at from api_keys where user_id = ${user.id}`
    expect(key?.last_used_at).toBeInstanceOf(Date)
  })

  it('says the chapter’s intro, with no words, and the chapter’s first sentences after it', async () => {
    const { user, cookie } = await reader()
    const response = await speak(cookie, { book: BOOK, chapter: 0, voice: VOICE, intro: true })
    expect(response.status).toBe(200)
    expect((await response.json()).words).toEqual([])
    const [sent] = stubSpeechRequests()
    expect(sent?.body.text).toBe(chapterIntro(chapter1))
    expect(sent?.body.previous_text).toBeUndefined()
    expect(String(sent?.body.next_text).startsWith(said(chapter1, 0)[0]?.say ?? 'none')).toBe(true)
    expect(await usageRows(user.id)).toEqual([{ characters: chapterIntro(chapter1).length, requests: 1 }])
  })

  it('takes previous_text across a page break, in the reader’s own private book', async () => {
    const { user, cookie } = await reader()
    const book = await privateBook(user.id)
    const response = await speak(cookie, {
      book,
      chapter: 0,
      voice: VOICE,
      position: { chapter: 'one', page: 2 },
      start: 0,
      end: 'The second page begins.'.length,
    })
    expect(response.status).toBe(200)
    const [sent] = stubSpeechRequests()
    expect(sent?.body).toMatchObject({
      text: 'The second page begins.',
      previous_text: 'The first page ends here.',
      next_text: 'It goes on.',
      language_code: 'en',
    })
  })

  it('answers each ElevenLabs failure with its code, logs only the status, and still counts the characters', async () => {
    const cases = [
      [STUB_ELEVENLABS_KEYS.rejected, 502, 'key_rejected'],
      [STUB_ELEVENLABS_KEYS.noCredits, 502, 'no_credits'],
      [STUB_ELEVENLABS_KEYS.busy, 503, 'busy'],
      [STUB_ELEVENLABS_KEYS.voiceGone, 404, 'voice_gone'],
    ] as const
    const errors = quiet()
    for (const [ending, status, error] of cases) {
      const { user, cookie } = await reader({ key: elevenLabsKey(ending) })
      const response = await speak(cookie, spanOf(0))
      expect([response.status, await response.json()], ending).toEqual([status, { error }])
      expect(await usageRows(user.id)).toEqual([{ characters: said(chapter1, 0)[0]?.say.length, requests: 1 }])
    }
    const failing = (async () => new Response('<html>down</html>', { status: 500 })) as typeof fetch
    const { cookie } = await reader()
    const down = await handleSpeak(post(cookie, spanOf(0)), { fetch: failing })
    expect([down.status, await down.json()]).toEqual([502, { error: 'failed' }])
    const logged = errors.mock.calls.join('\n')
    expect(logged).toContain('ElevenLabs answered 402 (no_credits)')
    expect(logged).not.toContain(said(chapter1, 0)[0]?.say ?? 'none')
    expect(logged).not.toContain('el-test-valid')
  })

  it('tries 128 kbps once when 64 kbps is refused, says so, and counts the characters once', async () => {
    const { user, cookie } = await reader({ key: elevenLabsKey(STUB_ELEVENLABS_KEYS.free) })
    const response = await speak(cookie, spanOf(0))
    expect(response.status).toBe(200)
    expect((await response.json()).format).toBe('standard')
    expect(stubSpeechRequests().map((r) => r.format)).toEqual(['mp3_44100_64', 'mp3_44100_128'])
    expect(await usageRows(user.id)).toEqual([{ characters: said(chapter1, 0)[0]?.say.length, requests: 1 }])

    resetElevenLabsStub()
    const standard = await speak(cookie, spanOf(1, 0, { format: 'standard' }))
    expect((await standard.json()).format).toBe('standard')
    expect(stubSpeechRequests().map((r) => r.format)).toEqual(['mp3_44100_128'])
  })

  it('answers permission when both rates are refused, counting the characters once', async () => {
    quiet()
    const { user, cookie } = await reader({ key: elevenLabsKey(STUB_ELEVENLABS_KEYS.noPermission) })
    const response = await speak(cookie, spanOf(0))
    expect([response.status, await response.json()]).toEqual([502, { error: 'permission' }])
    expect(stubSpeechRequests().map((r) => r.format)).toEqual(['mp3_44100_64', 'mp3_44100_128'])
    expect(await usageRows(user.id)).toEqual([{ characters: said(chapter1, 0)[0]?.say.length, requests: 1 }])
  })

  it('answers failed when a chapter can’t be read, as when a content file is broken', async () => {
    const errors = quiet()
    const { cookie } = await reader()
    vi.mocked(loadBook).mockRejectedValueOnce(new Error('unreadable content file'))
    const response = await speak(cookie, spanOf(0))
    expect([response.status, await response.json()]).toEqual([500, { error: 'failed' }])
    expect(errors.mock.calls.join(' ')).toContain('unreadable content file')
    expect(calls).toEqual([])
  })

  it('answers failed when the database does', async () => {
    const errors = quiet()
    const { cookie } = await reader()
    await raw`alter table speech_usage rename to speech_usage_gone`
    try {
      const response = await speak(cookie, spanOf(0))
      expect([response.status, await response.json()]).toEqual([500, { error: 'failed' }])
    } finally {
      await raw`alter table speech_usage_gone rename to speech_usage`
    }
    expect(errors).toHaveBeenCalled()
  })
})

describe('speechVoicesState', () => {
  const request = (cookie: string | null) =>
    new Request(`${origin}/_serverFn/getSpeechVoices`, { headers: cookie ? { cookie } : {} })
  const voices = (cookie: string | null, book = BOOK) => speechVoicesState(request(cookie), book, { fetch: stubFetch })

  it('lists the reader’s voices, the book’s language first, with only what the menu shows, and their model', async () => {
    const { user, cookie } = await reader()
    await setSpeechModel(db(), user.id, 'eleven_v4')
    expect(await voices(cookie)).toEqual({
      state: 'ready',
      model: 'eleven_v4',
      voices: [
        { id: 'StubVoiceAria01', name: 'Aria', accent: 'british', gender: 'female', languages: ['en'] },
        { id: 'StubVoiceBen02', name: 'Ben', accent: 'american', gender: 'male', languages: ['en'] },
        { id: 'StubVoiceCamille03', name: 'Camille', accent: 'parisian', gender: 'female', languages: ['fr'] },
      ],
    })
    expect(calls).toEqual(['https://api.elevenlabs.io/v2/voices?page_size=100'])
  })

  it('puts French voices first for the reader’s own French book', async () => {
    const { user, cookie } = await reader()
    const start = await startImport(db(), user.id, {
      title: 'Carnet',
      author: 'Ada',
      language: 'fr',
      details: NO_DETAILS,
      chapterCount: 1,
    })
    if (!start.ok) throw new Error('could not start')
    await storeChapter(db(), user.id, start.id, 0, { title: 'Un', pages: ['<p>Paris.</p>'] })
    await finishImport(db(), user.id, start.id, null)
    const state = await voices(cookie, privateBookSlug(start.id))
    expect(state.state === 'ready' && state.voices.map((v) => v.name)).toEqual(['Camille', 'Aria', 'Ben'])
  })

  it('says signed out, not found, no key, rejected, permission and unavailable', async () => {
    expect(await voices(null)).toEqual({ state: 'signed_out' })
    const { user, cookie } = await reader({ key: null })
    expect(await voices(cookie, 'no-such-book')).toEqual({ state: 'not_found' })
    expect(await voices(cookie, 'Not a slug')).toEqual({ state: 'not_found' })
    const other = await reader()
    expect(await voices(cookie, await privateBook(other.user.id))).toEqual({ state: 'not_found' })
    expect(await voices(cookie, await privateBook(user.id, false))).toEqual({ state: 'not_found' })
    expect(await voices(cookie)).toEqual({ state: 'no_key' })
    const errors = quiet()
    for (const [ending, state] of [
      [STUB_ELEVENLABS_KEYS.rejected, 'key_rejected'],
      [STUB_ELEVENLABS_KEYS.noVoices, 'permission'],
      [STUB_ELEVENLABS_KEYS.down, 'unavailable'],
    ] as const) {
      const r = await reader({ key: elevenLabsKey(ending) })
      expect(await voices(r.cookie), ending).toEqual({ state })
    }
    expect(errors.mock.calls.join(' ')).toContain('ElevenLabs answered 500')
    await raw`alter table api_keys rename to api_keys_gone`
    try {
      expect(await voices(cookie)).toEqual({ state: 'unavailable' })
    } finally {
      await raw`alter table api_keys_gone rename to api_keys`
    }
  })
})
