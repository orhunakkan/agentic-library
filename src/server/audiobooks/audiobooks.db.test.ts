import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, truncateSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { privateBookSlug } from '~/shared/content/book-slug'
import { testUser } from '../testing/users'

vi.mock('~/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/server/db')>()
  return { ...actual, getDb: vi.fn(actual.getDb) }
})

import { deleteAccount } from '~/server/admin/store'
import { handleBooksForm } from '~/server/book-actions'
import { openBook } from '~/server/books/book'
import { getConfig } from '~/server/config'
import { closeDb, getDb } from '~/server/db'
import { hashToken, newSessionToken } from '~/server/security'
import { createSession } from '~/server/sessions'
import {
  deleteBook,
  listBooks,
  loadBookPage,
  loadBookText,
  loadOutlines,
  loadReaderBook,
  loadSpeechChapter,
  loadWholeBook,
  startImport,
} from '~/server/user-books'
import type { AudiobookStart } from '~/shared/audiobooks/input'
import { GB } from '~/shared/audiobooks/limits'
import { NO_DETAILS } from '~/shared/import/details'
import { DEFAULT_LIMITS, type InstanceLimits } from '~/shared/limits/limits'
import { databaseUrl, freshDatabase } from '../testing/db'
import { type AudiobookOptions, handleAudioChunk, handleAudioFinish, handleNewAudiobook } from './actions'
import { audiobooksDir, audioPath, bookDir, forgetBookAudio, forgetUserAudio, freeBytes, sweep } from './files'
import { serveAudio } from './serve'
import {
  audioBytesUsed,
  audiobookChapters,
  loadAudiobook,
  readyAudioFile,
  recordChunk,
  startAudiobook,
  uploadingFile,
} from './store'

const raw = postgres(databaseUrl, { max: 1, onnotice: () => {} })
const db = () => getDb()
const config = getConfig() as { audiobooksDir: string | null; limits: InstanceLimits }
const root = mkdtempSync(join(tmpdir(), 'audiobooks-'))

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../../../tests/fixtures/audio/${name}`, import.meta.url)))
const M4B = fixture('three-chapters.m4b')
const MP3S = [fixture('chapter-1.mp3'), fixture('chapter-2.mp3'), fixture('chapter-3.mp3')]

const roomy: AudiobookOptions = { freeBytes: async () => 100 * GB }

beforeAll(freshDatabase)
afterAll(async () => {
  await raw.end()
  await closeDb()
  rmSync(root, { recursive: true, force: true })
})
beforeEach(async () => {
  await raw`truncate users, sessions, audit_events, login_attempts, user_books restart identity cascade`
  config.audiobooksDir = root
  config.limits = { ...DEFAULT_LIMITS }
})

const origin = getConfig().appOrigin
const cookieName = getConfig().cookieSecure ? '__Host-session' : 'session'
let users = 0

/** A plain member: no grant and no subscription, so every case shows audiobooks work for any account. */
async function signedIn() {
  const user = await testUser(db(), `listener-${++users}`, '$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA', 'member')
  const token = newSessionToken()
  await createSession(db(), { tokenHash: hashToken(token), userId: user.id, ip: null, userAgent: 'test' })
  return { user, cookie: `${cookieName}=${token}` }
}

const m4bStart = (over: Record<string, unknown> = {}) => ({
  title: 'The Fixture Audiobook',
  author: 'Ada Fixture',
  narrator: 'Rex Reader',
  language: 'en',
  details: { description: 'Three short chapters.', isbn: null, publisher: null, publishedYear: 2023 },
  files: [{ type: 'mp4', bytes: M4B.length }],
  chapters: [
    { title: 'Opening Credits', fileN: 1, startMs: 0, durationMs: 3000 },
    { title: 'The Storm', fileN: 1, startMs: 3000, durationMs: 3000 },
    { title: 'The Calm', fileN: 1, startMs: 6000, durationMs: 3000 },
  ],
  cover: false,
  ...over,
})

const mp3Start = () =>
  m4bStart({
    narrator: null,
    files: MP3S.map((f) => ({ type: 'mp3', bytes: f.length })),
    chapters: ['The Arrival', 'The Dinner', 'The Departure'].map((title, i) => ({
      title,
      fileN: i + 1,
      startMs: 0,
      durationMs: 3000,
    })),
  })

const startRequest = (cookie: string | null, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${origin}/account/books/new-audiobook`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

const start = (cookie: string | null, body: unknown, options = roomy, headers: Record<string, string> = {}) =>
  handleNewAudiobook(startRequest(cookie, body, headers), options)

const chunk = (
  cookie: string | null,
  id: string,
  n: string,
  offset: string | number,
  bytes: Uint8Array,
  options = roomy,
  headers: Record<string, string> = {},
) =>
  handleAudioChunk(
    new Request(`${origin}/account/books/${id}/audio/${n}?offset=${offset}`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/octet-stream', ...(cookie ? { cookie } : {}), ...headers },
      body: new Uint8Array(bytes),
    }),
    id,
    n,
    options,
  )

const finish = (cookie: string | null, id: string) =>
  handleAudioFinish(
    new Request(`${origin}/account/books/${id}/audio/finish`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: '{}',
    }),
    id,
  )

const fetchAudio = (
  cookie: string | null,
  id: string,
  n: string,
  headers: Record<string, string> = {},
  method = 'GET',
) =>
  serveAudio(
    new Request(`${origin}/account/books/${id}/audio/${n}`, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...headers },
    }),
    id,
    n,
  )

const answer = async (response: Response) => [response.status, await response.json()]

async function fillAudio(userId: number, bytes: number) {
  for (let left = bytes; left > 0; left -= 2 * GB)
    await raw`
      insert into user_books (user_id, title, author, language, chapter_count, format, audio_ms, audio_bytes)
      values (${userId}, 'Big', 'Ada', 'en', 1, 'audio', 1000, ${Math.min(left, 2 * GB)})`
}

async function started(cookie: string, body: unknown = m4bStart()): Promise<string> {
  const response = await start(cookie, body)
  const data = (await response.json()) as { id?: string; error?: string }
  if (response.status !== 201 || !data.id) throw new Error(`start: ${response.status} ${data.error}`)
  return data.id
}

async function imported(cookie: string, body: unknown = m4bStart(), files: Uint8Array[] = [M4B]): Promise<string> {
  const id = await started(cookie, body)
  for (const [i, file] of files.entries()) {
    const half = Math.floor(file.length / 2)
    expect((await chunk(cookie, id, String(i + 1), 0, file.subarray(0, half))).status).toBe(200)
    expect((await chunk(cookie, id, String(i + 1), half, file.subarray(half))).status).toBe(200)
  }
  expect(await answer(await finish(cookie, id))).toEqual([200, { ok: true }])
  return id
}

describe('POST /account/books/new-audiobook', () => {
  it('lets a plain member with no grant start, upload, finish and play an audiobook', async () => {
    const { cookie } = await signedIn()
    const id = await started(cookie)
    const half = Math.floor(M4B.length / 2)
    expect((await chunk(cookie, id, '1', 0, M4B.subarray(0, half))).status).toBe(200)
    expect((await chunk(cookie, id, '1', half, M4B.subarray(half))).status).toBe(200)
    expect(await answer(await finish(cookie, id))).toEqual([200, { ok: true }])
    expect((await fetchAudio(cookie, id, '1')).status).toBe(200)
  })

  it('starts an uploading audiobook with its files and chapters, and makes its directory', async () => {
    const { user, cookie } = await signedIn()
    const response = await start(cookie, m4bStart())
    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const { id } = (await response.json()) as { id: string }
    const [book] = await raw`
      select status, format, narrator, chapter_count, audio_bytes, audio_ms, description from user_books where id = ${id}`
    expect(book).toEqual({
      status: 'uploading',
      format: 'audio',
      narrator: 'Rex Reader',
      chapter_count: 3,
      audio_bytes: String(M4B.length),
      audio_ms: '9000',
      description: 'Three short chapters.',
    })
    expect(await uploadingFile(db(), user.id, id, 1)).toEqual({
      mediaType: 'audio/mp4',
      bytes: M4B.length,
      received: 0,
    })
    expect(await raw`select position, title, file_n, start_ms from user_book_audio_chapters order by position`).toEqual(
      [
        { position: 1, title: 'Opening Credits', file_n: 1, start_ms: 0 },
        { position: 2, title: 'The Storm', file_n: 1, start_ms: 3000 },
        { position: 3, title: 'The Calm', file_n: 1, start_ms: 6000 },
      ],
    )
    expect(existsSync(bookDir(root, user.id, id))).toBe(true)
    expect(await listBooks(db(), user.id)).toEqual([])
    expect(await loadAudiobook(db(), user.id, id)).toBeNull()
  })

  it('refuses a signed-out caller and bad bodies', async () => {
    const { cookie } = await signedIn()
    expect(await answer(await start(null, m4bStart()))).toEqual([401, { error: 'signed_out' }])
    expect(await answer(await start(cookie, '{'))).toEqual([400, { error: 'invalid' }])
    expect(await answer(await start(cookie, m4bStart({ files: [] })))).toEqual([400, { error: 'invalid' }])
    expect(await raw`select 1 from user_books`).toHaveLength(0)
  })

  it('is a 404 with audiobooks off, or a directory that isn’t there', async () => {
    const { cookie } = await signedIn()
    config.audiobooksDir = null
    expect(await answer(await start(cookie, m4bStart()))).toEqual([404, { error: 'not_found' }])
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      config.audiobooksDir = join(root, 'no-such-dir')
      expect(await audiobooksDir()).toBeNull()
      expect(await answer(await start(cookie, m4bStart()))).toEqual([404, { error: 'not_found' }])
      expect(errors.mock.calls.map((c) => String(c[0]))).toEqual([
        expect.stringMatching(/^\[audiobooks\] .*import is off/),
      ])
    } finally {
      errors.mockRestore()
    }
  })

  it('says quota for the configured books and audio, the hourly limit and the server’s disk', async () => {
    config.limits = { ...DEFAULT_LIMITS, books: 4, userAudioBytes: 3 * M4B.length }
    const { user, cookie } = await signedIn()
    const tight = { freeBytes: async () => 10 * GB + M4B.length - 1 }
    expect(await answer(await start(cookie, m4bStart(), tight))).toEqual([409, { error: 'quota', scope: 'server' }])
    expect((await start(cookie, m4bStart(), { freeBytes: async () => 10 * GB + M4B.length })).status).toBe(201)

    await fillAudio(user.id, M4B.length + 1)
    expect(await audioBytesUsed(db(), user.id)).toBe(2 * M4B.length + 1)
    expect(await answer(await start(cookie, m4bStart()))).toEqual([
      409,
      { error: 'quota', scope: 'audio', max: 3 * M4B.length },
    ])

    await raw`
      insert into user_books (user_id, title, author, language, chapter_count)
      select ${user.id}, 'Filler', 'Ada', 'en', 1 from generate_series(1, 2)`
    expect(await answer(await start(cookie, m4bStart()))).toEqual([409, { error: 'quota', scope: 'books', max: 4 }])

    await raw`delete from user_books where title = 'Filler'`
    await raw`
      insert into audit_events (user_id, event, detail)
      select ${user.id}, 'book.imported', '{}' from generate_series(1, 10)`
    expect(await answer(await start(cookie, m4bStart()))).toEqual([409, { error: 'quota', scope: 'rate', max: 10 }])
  })

  it('lets only one of two starts racing for the last of the account’s audio through', async () => {
    const { user, cookie } = await signedIn()
    await fillAudio(user.id, config.limits.userAudioBytes - M4B.length - 10)
    const both = await Promise.all([start(cookie, m4bStart()), start(cookie, m4bStart())])
    expect(both.map((r) => r.status).sort()).toEqual([201, 409])
  })

  it('sweeps stale uploads and directories no row names', async () => {
    const { user, cookie } = await signedIn()
    const stale = await started(cookie)
    await raw`update user_books set created_at = now() - interval '25 hours' where id = ${stale}`
    const stray = '0f9b8c7e-1d2a-4b3c-8d4e-5f6a7b8c9d0e'
    mkdirSync(bookDir(root, user.id, stray), { recursive: true })
    const fresh = await started(cookie)
    expect(existsSync(bookDir(root, user.id, stale))).toBe(false)
    expect(existsSync(bookDir(root, user.id, stray))).toBe(false)
    expect(existsSync(bookDir(root, user.id, fresh))).toBe(true)
    expect(await raw`select id from user_books`).toEqual([{ id: fresh }])
    expect(await sweep(root, 999_999, new Set())).toBe(0)
  })
})

describe('the start’s limits', () => {
  /** An audiobook of `bytes`, as the start parser hands it to the store. */
  const stored = (bytes = 1000): AudiobookStart => ({
    title: 'Stored',
    author: 'Ada',
    narrator: null,
    language: 'en',
    details: NO_DETAILS,
    type: 'mp4',
    files: [bytes],
    chapters: [{ title: 'One', fileN: 1, startMs: 0, durationMs: 3000 }],
    cover: false,
  })
  const book = { title: 'Text', author: 'Ada', language: 'en', details: NO_DETAILS, chapterCount: 1 }

  it('holds a start to the books limit it is given, counting books and audiobooks alike', async () => {
    const limits = { ...DEFAULT_LIMITS, books: 2 }
    const { user } = await signedIn()
    expect((await startAudiobook(db(), user.id, stored(), new Date(), limits)).ok).toBe(true)
    expect((await startImport(db(), user.id, book, new Date(), limits)).ok).toBe(true)
    expect(await startAudiobook(db(), user.id, stored(), new Date(), limits)).toEqual({
      ok: false,
      quota: 'books',
      max: 2,
    })
  })

  it('holds a start to the audio limit it is given: up to it is stored, past it refused with it', async () => {
    const limits = { ...DEFAULT_LIMITS, userAudioBytes: 3000, audiobookBytes: 2000 }
    const { user } = await signedIn()
    expect((await startAudiobook(db(), user.id, stored(2000), new Date(), limits)).ok).toBe(true)
    expect(await startAudiobook(db(), user.id, stored(1001), new Date(), limits)).toEqual({
      ok: false,
      quota: 'audio',
      max: 3000,
    })
    expect((await startAudiobook(db(), user.id, stored(1000), new Date(), limits)).ok).toBe(true)
    expect(await audioBytesUsed(db(), user.id)).toBe(3000)
  })

  it('keeps the audio of a listener over a lowered audio limit, lets them delete it, and refuses new starts', async () => {
    const { user } = await signedIn()
    const first = await startAudiobook(db(), user.id, stored(3000), new Date(), DEFAULT_LIMITS)
    const second = await startAudiobook(db(), user.id, stored(3000), new Date(), DEFAULT_LIMITS)
    if (!first.ok || !second.ok) throw new Error('could not start')
    const lowered = { ...DEFAULT_LIMITS, userAudioBytes: 2000, audiobookBytes: 2000 }
    const refused = { ok: false, quota: 'audio', max: 2000 }
    expect(await startAudiobook(db(), user.id, stored(1), new Date(), lowered)).toEqual(refused)
    expect(await deleteBook(db(), user.id, first.id)).toBe(true)
    expect(await audioBytesUsed(db(), user.id)).toBe(3000)
    expect(await startAudiobook(db(), user.id, stored(1), new Date(), lowered)).toEqual(refused)
  })

  it('keeps every audiobook of a listener over a lowered books limit, and refuses only new starts', async () => {
    const { user } = await signedIn()
    const ids: string[] = []
    for (let i = 0; i < 3; i++) {
      const started = await startAudiobook(db(), user.id, stored(), new Date(), DEFAULT_LIMITS)
      if (!started.ok) throw new Error('could not start')
      ids.push(started.id)
    }
    const lowered = { ...DEFAULT_LIMITS, books: 2 }
    const refused = { ok: false, quota: 'books', max: 2 }
    expect(await startAudiobook(db(), user.id, stored(), new Date(), lowered)).toEqual(refused)
    expect(await deleteBook(db(), user.id, ids[0] ?? '')).toBe(true)
    expect(await startAudiobook(db(), user.id, stored(), new Date(), lowered)).toEqual(refused)
  })
})

describe('POST /account/books/<id>/audio/<n>', () => {
  it('appends each chunk where the file has got to, and says where to resume after a wrong offset', async () => {
    const { user, cookie } = await signedIn()
    const id = await started(cookie)
    expect(await answer(await chunk(cookie, id, '1', 0, M4B.subarray(0, 1000)))).toEqual([200, { received: 1000 }])
    expect(await answer(await chunk(cookie, id, '1', 0, M4B.subarray(0, 1000)))).toEqual([
      409,
      { error: 'offset', received: 1000 },
    ])
    expect(await answer(await chunk(cookie, id, '1', 2000, M4B.subarray(2000, 3000)))).toEqual([
      409,
      { error: 'offset', received: 1000 },
    ])
    expect(await answer(await chunk(cookie, id, '1', 1000, M4B.subarray(1000)))).toEqual([
      200,
      { received: M4B.length },
    ])
    expect(new Uint8Array(readFileSync(audioPath(root, user.id, id, 1, 'mp4')))).toEqual(M4B)
    expect(await answer(await chunk(cookie, id, '1', M4B.length, new Uint8Array(1)))).toEqual([
      400,
      { error: 'invalid' },
    ])
  })

  it('refuses bad requests in the conventions’ order', async () => {
    const alice = await signedIn()
    const bob = await signedIn()
    const id = await started(alice.cookie)
    const some = M4B.subarray(0, 10)
    expect(await answer(await chunk(null, id, '1', 0, some))).toEqual([404, { error: 'not_found' }])
    expect(await answer(await chunk(bob.cookie, id, '1', 0, some))).toEqual([404, { error: 'not_found' }])
    for (const n of ['0', '2', '501', 'x', '01'])
      expect(await answer(await chunk(alice.cookie, id, n, 0, some)), n).toEqual([404, { error: 'not_found' }])
    expect(await answer(await chunk(alice.cookie, 'not-a-uuid', '1', 0, some))).toEqual([404, { error: 'not_found' }])
    expect(await answer(await chunk(alice.cookie, id, '1', '-1', some))).toEqual([400, { error: 'invalid' }])
    expect(await answer(await chunk(alice.cookie, id, '1', 0, new Uint8Array(0)))).toEqual([400, { error: 'invalid' }])
    const full = { freeBytes: async () => 5 * GB }
    expect(await answer(await chunk(alice.cookie, id, '1', 0, some, full))).toEqual([
      409,
      { error: 'quota', scope: 'server' },
    ])
    config.audiobooksDir = null
    expect(await answer(await chunk(alice.cookie, id, '1', 0, some))).toEqual([404, { error: 'not_found' }])
  })

  it('says a finished book’s file is whole', async () => {
    const { cookie } = await signedIn()
    const id = await imported(cookie)
    expect(await answer(await chunk(cookie, id, '1', 0, M4B.subarray(0, 10)))).toEqual([
      409,
      { error: 'offset', received: M4B.length },
    ])
  })

  it('rewinds to what is on disk when a write was lost, and cuts back a write whose count was lost', async () => {
    const { user, cookie } = await signedIn()
    const id = await started(cookie)
    const path = audioPath(root, user.id, id, 1, 'mp4')
    expect((await chunk(cookie, id, '1', 0, M4B.subarray(0, 1000))).status).toBe(200)
    truncateSync(path, 600)
    expect(await answer(await chunk(cookie, id, '1', 1000, M4B.subarray(1000, 2000)))).toEqual([
      409,
      { error: 'offset', received: 600 },
    ])
    expect((await chunk(cookie, id, '1', 600, M4B.subarray(600, 1200))).status).toBe(200)
    expect(await recordChunk(db(), user.id, id, 1, 0, 10)).toBeNull()
    expect(await answer(await chunk(cookie, id, '1', 1200, M4B.subarray(1200)))).toEqual([
      200,
      { received: M4B.length },
    ])
    expect(new Uint8Array(readFileSync(path))).toEqual(M4B)
  })

  it('counts a chunk once when two requests race for the same offset', async () => {
    const { cookie } = await signedIn()
    const id = await started(cookie)
    const piece = M4B.subarray(0, 1000)
    const both = await Promise.all([chunk(cookie, id, '1', 0, piece), chunk(cookie, id, '1', 0, piece)])
    expect(both.map((r) => r.status).sort()).toEqual([200, 409])
  })
})

describe('POST /account/books/<id>/audio/finish', () => {
  it('reads the M4B, fits its last chapter to the file’s length, and marks it ready', async () => {
    const { user, cookie } = await signedIn()
    const id = await imported(cookie)
    const chapters = await audiobookChapters(db(), user.id, id)
    expect(chapters.map((c) => [c.title, c.startMs])).toEqual([
      ['Opening Credits', 0],
      ['The Storm', 3000],
      ['The Calm', 6000],
    ])
    expect(chapters.at(-1)?.durationMs).toBe(3046)
    const [file] = await raw`select duration_ms from user_book_audio_files where book_id = ${id}`
    expect(file).toEqual({ duration_ms: 9046 })
    expect(await loadAudiobook(db(), user.id, id)).toMatchObject({
      title: 'The Fixture Audiobook',
      narrator: 'Rex Reader',
      audioMs: 9046,
      audioBytes: M4B.length,
      type: 'mp4',
      fileCount: 1,
    })
    const [event] = await raw<{ event: string; detail: Record<string, unknown> }[]>`
      select event, detail from audit_events where event = 'book.imported'`
    expect(event?.detail).toEqual({ bookId: id, format: 'audio', files: 1, bytes: M4B.length, ms: 9046 })
    expect(JSON.stringify(event)).not.toContain('Fixture')
    expect(await listBooks(db(), user.id)).toEqual([
      expect.objectContaining({ id, format: 'audio', audioMs: 9046, title: 'The Fixture Audiobook' }),
    ])
  })

  it('reads three MP3s, one chapter each', async () => {
    const { user, cookie } = await signedIn()
    const id = await imported(cookie, mp3Start(), MP3S)
    expect((await audiobookChapters(db(), user.id, id)).map((c) => [c.fileN, c.durationMs])).toEqual([
      [1, 10057],
      [2, 10057],
      [3, 10057],
    ])
    expect(await loadAudiobook(db(), user.id, id)).toMatchObject({ type: 'mp3', fileCount: 3, audioMs: 3 * 10057 })
    expect(await readyAudioFile(db(), user.id, id, 2)).toEqual({ mediaType: 'audio/mpeg', bytes: MP3S[1]?.length })
  })

  it('waits until every file is whole', async () => {
    const { cookie } = await signedIn()
    const id = await started(cookie)
    expect(await answer(await finish(cookie, id))).toEqual([409, { error: 'incomplete' }])
    expect((await chunk(cookie, id, '1', 0, M4B.subarray(0, 100))).status).toBe(200)
    expect(await answer(await finish(cookie, id))).toEqual([409, { error: 'incomplete' }])
  })

  it('refuses a copy-protected file, deleting the book and its files', async () => {
    const { user, cookie } = await signedIn()
    const drm = fixture('drm.m4b')
    const id = await started(cookie, m4bStart({ files: [{ type: 'mp4', bytes: drm.length }] }))
    expect((await chunk(cookie, id, '1', 0, drm)).status).toBe(200)
    expect(await answer(await finish(cookie, id))).toEqual([400, { error: 'drm' }])
    expect(await raw`select 1 from user_books`).toHaveLength(0)
    expect(existsSync(bookDir(root, user.id, id))).toBe(false)
  })

  it('refuses a file it can’t read, saying why', async () => {
    const { cookie } = await signedIn()
    const truncated = fixture('truncated.m4b')
    const id = await started(cookie, m4bStart({ files: [{ type: 'mp4', bytes: truncated.length }] }))
    expect((await chunk(cookie, id, '1', 0, truncated)).status).toBe(200)
    const [status, body] = await answer(await finish(cookie, id))
    expect([status, body.error]).toEqual([400, 'unreadable'])
    expect(body.reason).toMatch(/\S/)
    expect(body.reason).not.toMatch(/\n|at .*\.js/)
    expect(await raw`select 1 from user_books`).toHaveLength(0)
  })

  it('refuses a file that isn’t what the start said, and chapters past the file’s end', async () => {
    const { cookie } = await signedIn()
    const mp3 = MP3S[0] as Uint8Array
    const asM4b = await started(cookie, m4bStart({ files: [{ type: 'mp4', bytes: mp3.length }] }))
    expect((await chunk(cookie, asM4b, '1', 0, mp3)).status).toBe(200)
    expect(await answer(await finish(cookie, asM4b))).toEqual([
      400,
      { error: 'unreadable', reason: 'it isn’t an M4B file' },
    ])
    const long = m4bStart({
      chapters: [
        { title: 'One', fileN: 1, startMs: 0, durationMs: 9500 },
        { title: 'Two', fileN: 1, startMs: 9500, durationMs: 1000 },
      ],
    })
    const id = await started(cookie, long)
    expect((await chunk(cookie, id, '1', 0, M4B)).status).toBe(200)
    expect(await answer(await finish(cookie, id))).toEqual([
      400,
      { error: 'unreadable', reason: 'its chapters don’t fit its length' },
    ])
  })

  it('is a 404 for another user, a bad id, a finished book and audiobooks off', async () => {
    const alice = await signedIn()
    const bob = await signedIn()
    const id = await imported(alice.cookie)
    expect(await answer(await finish(bob.cookie, id))).toEqual([404, { error: 'not_found' }])
    expect(await answer(await finish(alice.cookie, id))).toEqual([404, { error: 'not_found' }])
    expect(await answer(await finish(alice.cookie, 'nope'))).toEqual([404, { error: 'not_found' }])
    config.audiobooksDir = null
    expect(await answer(await finish(alice.cookie, id))).toEqual([404, { error: 'not_found' }])
  })
})

describe('GET /account/books/<id>/audio/<n>', () => {
  it('serves the owner the whole file, a range and HEAD, private and unsniffed', async () => {
    const { cookie } = await signedIn()
    const id = await imported(cookie)
    const whole = await fetchAudio(cookie, id, '1')
    expect(whole.status).toBe(200)
    expect(Object.fromEntries(whole.headers)).toMatchObject({
      'content-type': 'audio/mp4',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'accept-ranges': 'bytes',
      'content-length': String(M4B.length),
    })
    expect(new Uint8Array(await whole.arrayBuffer())).toEqual(M4B)
    const part = await fetchAudio(cookie, id, '1', { range: 'bytes=0-99' })
    expect(part.status).toBe(206)
    expect(part.headers.get('content-range')).toBe(`bytes 0-99/${M4B.length}`)
    expect((await part.arrayBuffer()).byteLength).toBe(100)
    const head = await fetchAudio(cookie, id, '1', {}, 'HEAD')
    expect([head.status, head.headers.get('content-length'), await head.text()]).toEqual([200, String(M4B.length), ''])
    expect((await fetchAudio(cookie, id, '1', { range: `bytes=${M4B.length}-` })).status).toBe(416)
  })

  it('is a 404 for anyone else, an unfinished upload, a bad number, a missing file and audiobooks off', async () => {
    const alice = await signedIn()
    const bob = await signedIn()
    const id = await imported(alice.cookie)
    const unfinished = await started(alice.cookie)
    expect((await fetchAudio(null, id, '1')).status).toBe(404)
    expect((await fetchAudio(bob.cookie, id, '1')).status).toBe(404)
    expect((await fetchAudio(alice.cookie, unfinished, '1')).status).toBe(404)
    expect((await fetchAudio(alice.cookie, id, '2')).status).toBe(404)
    expect((await fetchAudio(alice.cookie, id, 'x')).status).toBe(404)
    expect((await fetchAudio(alice.cookie, 'nope', '1')).status).toBe(404)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      unlinkSync(audioPath(root, alice.user.id, id, 1, 'mp4'))
      expect((await fetchAudio(alice.cookie, id, '1')).status).toBe(404)
      expect((await fetchAudio(alice.cookie, id, '1')).status).toBe(404)
      expect(errors).toHaveBeenCalledTimes(1)
    } finally {
      errors.mockRestore()
    }
    config.audiobooksDir = null
    expect((await fetchAudio(alice.cookie, id, '1')).status).toBe(404)
  })
})

describe('deleting', () => {
  const deleteForm = (cookie: string, id: string) =>
    handleBooksForm(
      new Request(`${origin}/account/books`, {
        method: 'POST',
        headers: { origin, cookie, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ intent: 'delete', id }),
      }),
    )

  it('removes the book’s rows and then its directory', async () => {
    const { user, cookie } = await signedIn()
    const id = await imported(cookie)
    const response = await deleteForm(cookie, id)
    expect([response.status, response.headers.get('location')]).toEqual([303, '/account/books?status=deleted'])
    expect(await raw`select 1 from user_book_audio_files`).toHaveLength(0)
    expect(existsSync(bookDir(root, user.id, id))).toBe(false)
  })

  it('removes a deleted account’s audiobook directory', async () => {
    const { user, cookie } = await signedIn()
    await imported(cookie)
    expect(await deleteAccount(db(), user.id, { detail: { via: 'test' } })).toBe('deleted')
    expect(existsSync(join(root, String(user.id)))).toBe(false)
    const other = await signedIn()
    config.audiobooksDir = null
    expect(await deleteAccount(db(), other.user.id, { detail: { via: 'test' } })).toBe('deleted')
  })
})

describe('the text paths', () => {
  it('find no text in an audiobook, and sync and bookmarks find its episodes for its owner only', async () => {
    const alice = await signedIn()
    const bob = await signedIn()
    const id = await imported(alice.cookie)
    const userId = alice.user.id
    expect(await loadReaderBook(db(), userId, id, 'chapter-1', 0)).toBeNull()
    expect(await loadSpeechChapter(db(), userId, id, 0)).toBeNull()
    expect(await loadWholeBook(db(), userId, id)).toBeNull()
    expect(await loadBookText(db(), userId, id)).toBeNull()
    expect(await loadBookPage(db(), userId, id)).toBeNull()
    expect(await loadOutlines(db(), userId, [id])).toEqual(new Map())
    const book = await openBook(db(), userId, privateBookSlug(id))
    expect(book?.format).toBe('audio')
    expect((await book?.audio())?.episodes.map((e) => e.id)).toEqual(['1', '2', '3'])
    expect(await openBook(db(), bob.user.id, privateBookSlug(id))).toBeNull()
  })
})

describe('when something fails', () => {
  it('answers 500 failed, or 503 for the audio, and logs the context without the body', async () => {
    const { cookie } = await signedIn()
    const id = await imported(cookie)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const real = vi.mocked(getDb).getMockImplementation() as typeof getDb
    const breakAfterSession = () =>
      vi
        .mocked(getDb)
        .mockImplementationOnce(real)
        .mockImplementationOnce(() => {
          throw new Error('database down')
        })
    try {
      breakAfterSession()
      expect(await answer(await start(cookie, m4bStart()))).toEqual([500, { error: 'failed' }])
      breakAfterSession()
      expect(await answer(await chunk(cookie, id, '1', 0, M4B.subarray(0, 10)))).toEqual([500, { error: 'failed' }])
      breakAfterSession()
      expect(await answer(await finish(cookie, id))).toEqual([500, { error: 'failed' }])
      breakAfterSession()
      expect((await fetchAudio(cookie, id, '1')).status).toBe(503)
      const lines = errors.mock.calls.map((call) => String(call[0]))
      expect(lines).toEqual([
        expect.stringMatching(/^\[audiobook start\] /),
        expect.stringMatching(/^\[audiobook chunk\] /),
        expect.stringMatching(/^\[audiobook finish\] /),
        expect.stringMatching(/^\[audiobook serve\] /),
      ])
      expect(lines.join('\n')).not.toContain('Fixture')
    } finally {
      errors.mockRestore()
    }
  })

  it('logs, and doesn’t throw, when a deleted book’s or account’s files can’t be removed', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await forgetBookAudio(1, 'not-a-book-id')
      await forgetUserAudio(0)
      expect(errors.mock.calls.map((call) => String(call[0]))).toEqual([
        expect.stringMatching(/^\[audiobooks remove book\] /),
        expect.stringMatching(/^\[audiobooks remove user\] /),
      ])
    } finally {
      errors.mockRestore()
    }
  })

  it('reads the disk’s free space', async () => {
    expect(await freeBytes(root)).toBeGreaterThan(0)
  })
})
