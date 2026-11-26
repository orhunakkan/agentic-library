import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getConfig } from '~/server/config'
import { closeDb, getDb, type Pool } from '~/server/db'
import { privateBookSlug } from '~/shared/content/book-slug'
import { NO_DETAILS } from '../../shared/import/details.ts'
import { privateRef } from '../testing/refs'
import { testUser } from '../testing/users'

vi.mock('~/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/server/db')>()
  return { ...actual, getDb: vi.fn(actual.getDb) }
})

import { type BookRef, refFor, slugOf } from '~/server/books/ref'
import { hashToken, newSessionToken } from '~/server/security'
import { createSession } from '~/server/sessions'
import { handleSync } from '~/server/sync/actions'
import { newPlaceCache, placeForRead, resolveEpisode, resolvePlace } from '~/server/sync/places'
import { readingPlaceState, syncState } from '~/server/sync/read'
import { getSettings, listListening, listReading, readingFor, type SyncItems, saveBatch } from '~/server/sync/store'
import { deleteBook, finishImport, loadOutlines, startImport, storeChapter } from '~/server/user-books'
import { DEFAULT_LIMITS } from '~/shared/limits/limits'
import { addDays, dayIn } from '~/shared/reading-stats/days'
import type { SyncState } from '~/shared/sync/sync'
import { readyAudiobook } from '../testing/audiobooks'
import { databaseUrl, freshDatabase } from '../testing/db'

const raw = postgres(databaseUrl, { max: 1, onnotice: () => {} })
const db = () => getDb()

beforeAll(freshDatabase)
afterAll(async () => {
  await raw.end()
  await closeDb()
})
beforeEach(async () => {
  await raw`truncate users, sessions, user_books, reading_places, listening_places, reader_settings, reading_time restart identity cascade`
})

let users = 0
const newUser = () => testUser(db(), `reader-${++users}`, '$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA', 'member')

const PRIDE: BookRef = refFor('pride-and-prejudice')
const PROPHET: BookRef = refFor('the-prophet')

async function privateBook(userId: number, title = 'Notes'): Promise<BookRef & { userBookId: string }> {
  const start = await startImport(
    db(),
    userId,
    {
      title,
      author: 'Ada',
      language: 'en',
      details: NO_DETAILS,
      chapterCount: 2,
    },
    new Date(),
    DEFAULT_LIMITS,
  )
  if (!start.ok) throw new Error('could not start')
  await storeChapter(
    db(),
    userId,
    start.id,
    0,
    { title: 'Opening', pages: ['<p>one</p>', '<p>two</p>'] },
    DEFAULT_LIMITS,
  )
  await storeChapter(db(), userId, start.id, 1, { title: 'Second', pages: ['<p>three</p>'] }, DEFAULT_LIMITS)
  expect(await finishImport(db(), userId, start.id, null)).toBe('ok')
  return privateRef(start.id)
}

const none: SyncItems = { reading: [], listening: [], settings: null }
const save = (userId: number, items: Partial<SyncItems>, device = 'Safari on iPhone') =>
  saveBatch(db(), userId, device, { ...none, ...items })

describe('the tables', () => {
  it('refuse an episode row on no book, a voice row with half a position, and both book columns', async () => {
    const user = await newUser()
    const book = await privateBook(user.id)
    const listening = (fields: Record<string, unknown>) =>
      raw`insert into listening_places ${raw({ user_id: user.id, at: new Date(), device: 'x', ...fields })}`
    await listening({ user_book_id: book.userBookId, kind: 'episode', episode: 'ep_1', position_ms: 1 })
    await expect(listening({ kind: 'episode', episode: 'ep_1', position_ms: 1 })).rejects.toThrow(/check/)
    await expect(listening({ book_slug: 'emma', kind: 'voice', chapter_index: 1, page: 1 })).rejects.toThrow(/check/)
    await expect(listening({ book_slug: 'emma', kind: 'voice', episode: 'ep_1' })).rejects.toThrow(/check/)
    await expect(
      raw`insert into reading_places (user_id, book_slug, user_book_id, page, at, device)
          values (${user.id}, 'emma', ${book.userBookId}, 1, now(), 'x')`,
    ).rejects.toThrow(/check/)
    await expect(
      raw`insert into reading_places (user_id, page, at, device) values (${user.id}, 1, now(), 'x')`,
    ).rejects.toThrow(/check/)
    await expect(
      raw`insert into reader_settings (user_id, settings, at, device) values (${user.id}, '[1]', now(), 'x')`,
    ).rejects.toThrow(/check/)
    await listening({ book_slug: 'emma', kind: 'voice' })
    await listening({
      user_book_id: book.userBookId,
      kind: 'voice',
      chapter_index: 0,
      chapter: 'a',
      page: 1,
      start_offset: 3,
    })
  })
})

describe('the store', () => {
  it('replaces a reading place only with a newer one', async () => {
    const user = await newUser()
    await save(user.id, { reading: [{ ref: PRIDE, chapter: 'chapter-6', page: 2, at: 2000 }] })
    await save(user.id, { reading: [{ ref: PRIDE, chapter: 'chapter-1', page: 1, at: 1000 }] }, 'Older device')
    await save(user.id, { reading: [{ ref: PRIDE, chapter: 'chapter-2', page: 1, at: 2000 }] }, 'Same time')
    expect(await readingFor(db(), user.id, PRIDE)).toEqual({
      ref: PRIDE,
      chapter: 'chapter-6',
      page: 2,
      at: new Date(2000),
      device: 'Safari on iPhone',
    })
    await save(user.id, { reading: [{ ref: PRIDE, chapter: 'chapter-7', page: 1, at: 3000 }] }, 'Chrome on macOS')
    expect(await readingFor(db(), user.id, PRIDE)).toMatchObject({ chapter: 'chapter-7', device: 'Chrome on macOS' })
    expect(await readingFor(db(), user.id, PROPHET)).toBeNull()
  })

  it('keeps one reading place per book and user, private books included, newest first', async () => {
    const user = await newUser()
    const other = await newUser()
    const book = await privateBook(user.id)
    await save(user.id, {
      reading: [
        { ref: PRIDE, chapter: 'chapter-1', page: 1, at: 1 },
        { ref: book, chapter: 'opening', page: 2, at: 3 },
        { ref: refFor('confessions-of-al-ghazzali'), chapter: null, page: 9, at: 2 },
      ],
    })
    await save(other.id, { reading: [{ ref: PRIDE, chapter: 'chapter-9', page: 1, at: 9 }] })
    expect((await listReading(db(), user.id, 50)).map((r) => [r.ref, r.chapter, r.page])).toEqual([
      [book, 'opening', 2],
      [refFor('confessions-of-al-ghazzali'), null, 9],
      [PRIDE, 'chapter-1', 1],
    ])
    expect(await listReading(db(), user.id, 1)).toHaveLength(1)
    expect(await readingFor(db(), user.id, book)).toMatchObject({ page: 2 })
  })

  it('writes a private book only while it is the user’s and ready', async () => {
    const owner = await newUser()
    const other = await newUser()
    const book = await privateBook(owner.id)
    await save(other.id, { reading: [{ ref: book, chapter: 'opening', page: 1, at: 1 }] })
    await save(other.id, {
      listening: [
        { ref: book, kind: 'voice', place: { chapterIndex: 0, chapter: 'opening', page: 1, offset: 0 }, at: 1 },
      ],
    })
    expect(await raw`select 1 from reading_places`).toHaveLength(0)
    expect(await raw`select 1 from listening_places`).toHaveLength(0)
  })

  it('replaces an episode position only with a newer one, and keeps a finished episode', async () => {
    const user = await newUser()
    const episode = (positionMs: number | null, at: number) => ({
      ref: PROPHET,
      kind: 'episode' as const,
      episode: 'ep_1',
      positionMs,
      at,
    })
    await save(user.id, { listening: [episode(30_000, 10)] })
    await save(user.id, { listening: [episode(5_000, 5)] })
    await save(user.id, { listening: [episode(6_000, 10)] })
    expect((await listListening(db(), user.id, 100))[0]).toMatchObject({ kind: 'episode', positionMs: 30_000 })
    await save(user.id, { listening: [episode(null, 20)] })
    await save(user.id, { listening: [episode(40_000, 15)] })
    expect(await listListening(db(), user.id, 100)).toEqual([
      {
        ref: PROPHET,
        kind: 'episode',
        episode: 'ep_1',
        positionMs: null,
        at: new Date(20),
        device: 'Safari on iPhone',
      },
    ])
  })

  it('replaces a voice position only with a newer one, and keeps a finished book', async () => {
    const user = await newUser()
    const book = await privateBook(user.id)
    const voice = (ref: BookRef, offset: number | null, at: number) => ({
      ref,
      kind: 'voice' as const,
      place: offset === null ? null : { chapterIndex: 5, chapter: 'chapter-6', page: 2, offset },
      at,
    })
    await save(user.id, { listening: [voice(PRIDE, 40, 10), voice(book, 0, 11)] })
    await save(user.id, { listening: [voice(PRIDE, 10, 9), voice(PRIDE, 20, 10)] })
    expect(await listListening(db(), user.id, 100)).toEqual([
      expect.objectContaining({ ref: book, kind: 'voice', chapterIndex: 5, offset: 0 }),
      expect.objectContaining({
        ref: PRIDE,
        kind: 'voice',
        chapterIndex: 5,
        chapter: 'chapter-6',
        page: 2,
        offset: 40,
      }),
    ])
    await save(user.id, { listening: [voice(PRIDE, null, 30)] })
    await save(user.id, { listening: [voice(PRIDE, 50, 25)] })
    expect((await listListening(db(), user.id, 100))[0]).toMatchObject({
      ref: PRIDE,
      chapterIndex: null,
      chapter: null,
      page: null,
      offset: null,
    })
    expect(await listListening(db(), user.id, 1)).toHaveLength(1)
  })

  it('replaces the settings only with newer ones', async () => {
    const user = await newUser()
    expect(await getSettings(db(), user.id)).toBeNull()
    const values = (theme: string) => ({ theme, font: 'geist', leading: 'normal', measure: 'wide' })
    await save(user.id, { settings: { values: values('sepia'), at: 10 } })
    await save(user.id, { settings: { values: values('dark'), at: 10 } })
    await save(user.id, { settings: { values: values('light'), at: 5 } })
    expect(await getSettings(db(), user.id)).toEqual({
      settings: values('sepia'),
      at: new Date(10),
      device: 'Safari on iPhone',
    })
    await save(user.id, { settings: { values: values('dark'), at: 11 } }, 'Firefox on Linux')
    expect(await getSettings(db(), user.id)).toMatchObject({ settings: values('dark'), device: 'Firefox on Linux' })
  })

  it('goes with the private book, and everything goes with the user', async () => {
    const user = await newUser()
    const book = await privateBook(user.id)
    await save(user.id, {
      reading: [
        { ref: book, chapter: 'opening', page: 1, at: 1 },
        { ref: PRIDE, chapter: 'chapter-1', page: 1, at: 1 },
      ],
      listening: [{ ref: book, kind: 'voice', place: null, at: 1 }],
      settings: { values: { theme: 'dark' }, at: 1 },
    })
    expect(await deleteBook(db(), user.id, book.userBookId)).toBe(true)
    expect(await raw`select book_slug from reading_places`).toEqual([{ book_slug: 'pride-and-prejudice' }])
    expect(await raw`select 1 from listening_places`).toHaveLength(0)
    await raw`delete from users where id = ${user.id}`
    expect(await raw`select 1 from reading_places`).toHaveLength(0)
    expect(await raw`select 1 from reader_settings`).toHaveLength(0)
  })
})

describe('loadOutlines', () => {
  it('loads the user’s ready books’ outlines in one go, without their pages', async () => {
    const user = await newUser()
    const other = await newUser()
    const a = await privateBook(user.id, 'First')
    const b = await privateBook(user.id, 'Second book')
    const theirs = await privateBook(other.id)
    const outlines = await loadOutlines(db(), user.id, [a.userBookId, b.userBookId, theirs.userBookId, 'not-a-uuid'])
    expect([...outlines.keys()].sort()).toEqual([a.userBookId, b.userBookId].sort())
    expect(outlines.get(a.userBookId)).toEqual({
      title: 'First',
      chapters: [
        { slug: 'opening', title: 'Opening', pageCount: 2 },
        { slug: 'second', title: 'Second', pageCount: 1 },
      ],
    })
    expect((await loadOutlines(db(), user.id, [])).size).toBe(0)
  })
})

const origin = getConfig().appOrigin
const cookieName = getConfig().cookieSecure ? '__Host-session' : 'session'
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

async function signedIn() {
  const user = await newUser()
  const token = newSessionToken()
  await createSession(db(), { tokenHash: hashToken(token), userId: user.id, ip: null, userAgent: 'test' })
  return { user, cookie: `${cookieName}=${token}` }
}

const post = (cookie: string | null, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${origin}/account/sync`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

const sync = (cookie: string | null, body: unknown, headers: Record<string, string> = {}) =>
  handleSync(post(cookie, body, headers))

const answer = async (response: Response) => [
  response.status,
  response.status === 403 ? null : ((await response.json()) as object),
]

const get = (cookie: string | null) => new Request(`${origin}/read/x`, { headers: cookie ? { cookie } : {} })
const state = (cookie: string | null) => syncState(get(cookie))
const ready = async (cookie: string) => {
  const found = await state(cookie)
  if (found.state !== 'ready') throw new Error(found.state)
  return found as Extract<SyncState, { state: 'ready' }>
}

const settings = { theme: 'sepia', font: 'opendyslexic', leading: 'relaxed', measure: 'wide' }

describe('POST /account/sync', () => {
  it('refuses a signed-out request and bad bodies, and a body over its 16 KiB cap', async () => {
    const { cookie } = await signedIn()
    const reading = [{ book: 'pride-and-prejudice', position: { chapter: 'chapter-6', page: 2 }, at: 1 }]
    expect(await answer(await sync(null, { reading }))).toEqual([401, { error: 'signed_out' }])
    expect(await answer(await sync(cookie, '{'))).toEqual([400, { error: 'invalid' }])
    expect(await answer(await sync(cookie, {}))).toEqual([400, { error: 'invalid' }])
    expect(await answer(await sync(cookie, { reading: [{ ...reading[0], title: 'x' }] }))).toEqual([
      400,
      { error: 'invalid' },
    ])
    expect(await answer(await sync(cookie, 'x'.repeat(17 * 1024)))).toEqual([413, { error: 'invalid' }])
    expect(await raw`select 1 from reading_places`).toHaveLength(0)
  })

  it('saves a batch of every kind, with the device from the User-Agent', async () => {
    const { user, cookie } = await signedIn()
    const book = await privateBook(user.id)
    const slug = slugOf(book)
    const response = await sync(
      cookie,
      {
        reading: [
          { book: 'pride-and-prejudice', position: { chapter: 'chapter-6', page: 2 }, at: 1000 },
          { book: 'confessions-of-al-ghazzali', position: { printedPage: 11 }, at: 900 },
          { book: slug, position: { chapter: 'opening', page: 2 }, at: 800 },
        ],
        listening: [
          { book: 'the-prophet', kind: 'episode', episode: 'ep_1', positionMs: 15_000, at: 700 },
          {
            book: 'pride-and-prejudice',
            kind: 'voice',
            position: { chapter: 'chapter-6', page: 2 },
            offset: 40,
            at: 600,
          },
          { book: slug, kind: 'voice', position: null, offset: 0, at: 500 },
        ],
        settings: { values: settings, at: 400 },
      },
      { 'user-agent': IPHONE },
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ ok: true, skipped: 0 })

    const found = await ready(cookie)
    expect(found.reading).toEqual([
      {
        book: 'pride-and-prejudice',
        bookTitle: 'Pride and Prejudice',
        chapterTitle: 'Chapter 6',
        href: '/read/pride-and-prejudice/chapter-6/2',
        label: 'Ch. 6 · p. 2',
        position: { chapter: 'chapter-6', page: 2 },
        at: 1000,
        device: 'Safari on iPhone',
      },
      expect.objectContaining({
        book: 'confessions-of-al-ghazzali',
        href: '/read/confessions-of-al-ghazzali/11',
        label: 'p. 11',
        position: { printedPage: 11 },
      }),
      {
        book: slug,
        bookTitle: 'Notes',
        chapterTitle: 'Opening',
        href: `/read/${slug}/opening/2`,
        label: 'Ch. 1 · p. 2',
        position: { chapter: 'opening', page: 2 },
        at: 800,
        device: 'Safari on iPhone',
      },
    ])
    expect(found.listening).toEqual([
      {
        book: 'the-prophet',
        kind: 'episode',
        episode: 'ep_1',
        positionMs: 15_000,
        at: 700,
        device: 'Safari on iPhone',
      },
      {
        book: 'pride-and-prejudice',
        kind: 'voice',
        chapter: 5,
        position: { chapter: 'chapter-6', page: 2 },
        offset: 40,
        at: 600,
        device: 'Safari on iPhone',
      },
      { book: slug, kind: 'voice', chapter: 0, position: null, offset: 0, at: 500, device: 'Safari on iPhone' },
    ])
    expect(found.settings).toEqual({ values: settings, at: 400, device: 'Safari on iPhone' })
  })

  it('skips and counts what isn’t there, and saves the rest', async () => {
    const alice = await signedIn()
    const bob = await signedIn()
    const hers = await privateBook(alice.user.id)
    const response = await sync(bob.cookie, {
      reading: [
        { book: 'no-such-book', position: { chapter: 'chapter-1', page: 1 }, at: 1 },
        { book: slugOf(hers), position: { chapter: 'opening', page: 1 }, at: 1 },
        { book: 'pride-and-prejudice', position: { chapter: 'chapter-6', page: 99 }, at: 1 },
        { book: 'confessions-of-al-ghazzali', position: { chapter: 'intro', page: 1 }, at: 1 },
        { book: 'fixture-code-book', position: { chapter: 'values-and-names', page: 1 }, at: 1 },
      ],
      listening: [
        { book: 'the-prophet', kind: 'episode', episode: 'ep_99', positionMs: 1, at: 1 },
        { book: slugOf(hers), kind: 'episode', episode: 'ep_1', positionMs: 1, at: 1 },
        { book: slugOf(hers), kind: 'voice', position: null, offset: 0, at: 1 },
        { book: 'pride-and-prejudice', kind: 'voice', position: { chapter: 'nowhere', page: 1 }, offset: 0, at: 1 },
      ],
    })
    expect(await answer(response)).toEqual([200, { ok: true, skipped: 8 }])
    expect(await raw`select book_slug from reading_places`).toHaveLength(1)
    expect(await raw`select 1 from listening_places`).toHaveLength(0)
  })

  it('takes an episode’s length for a time past its end, and the server’s clock for a time ahead of it', async () => {
    const { cookie } = await signedIn()
    const before = Date.now()
    await sync(cookie, {
      listening: [
        { book: 'the-prophet', kind: 'episode', episode: 'ep_2', positionMs: 900_000, at: before + 86_400_000 },
      ],
    })
    const [row] = await raw<{ position_ms: number; at: Date }[]>`select position_ms, at from listening_places`
    expect(row?.position_ms).toBe(207_000)
    expect(row?.at.getTime()).toBeGreaterThanOrEqual(before)
    expect(row?.at.getTime()).toBeLessThanOrEqual(Date.now())
  })

  it('saves a chapter of the reader’s own audiobook as an episode, and reads it back, but not another reader’s', async () => {
    const alice = await signedIn()
    const bob = await signedIn()
    const id = await readyAudiobook(raw, alice.user.id, [60_000, 90_000])
    const book = privateBookSlug(id)
    const listening = [
      { book, kind: 'episode', episode: '2', positionMs: 30_000, at: 1000 },
      { book, kind: 'episode', episode: '1', positionMs: 99_000, at: 1000 },
      { book, kind: 'episode', episode: '3', positionMs: 1, at: 1000 },
    ]
    expect(await answer(await sync(alice.cookie, { listening }))).toEqual([200, { ok: true, skipped: 1 }])
    expect(await answer(await sync(bob.cookie, { listening }))).toEqual([200, { ok: true, skipped: 3 }])
    const newer = [{ book, kind: 'episode', episode: '2', positionMs: 45_000, at: 2000 }]
    expect(await answer(await sync(alice.cookie, { listening: newer }))).toEqual([200, { ok: true, skipped: 0 }])
    const { listening: read } = await ready(alice.cookie)
    expect(read.map((l) => l.kind === 'episode' && [l.book, l.episode, l.positionMs]).sort()).toEqual([
      [book, '1', 60_000],
      [book, '2', 45_000],
    ])
    expect((await ready(bob.cookie)).listening).toEqual([])
  })

  it('keeps the newer place whichever device sends last', async () => {
    const { cookie } = await signedIn()
    const place = (chapter: string, at: number) => ({
      reading: [{ book: 'pride-and-prejudice', position: { chapter, page: 1 }, at }],
    })
    await sync(cookie, place('chapter-8', 2000), { 'user-agent': IPHONE })
    await sync(cookie, place('chapter-2', 1000))
    expect((await ready(cookie)).reading[0]).toMatchObject({ label: 'Ch. 8 · p. 1', device: 'Safari on iPhone' })
  })

  it('answers 500 failed when the database fails after sign-in, and logs it without the body', async () => {
    const { cookie } = await signedIn()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = (() => {
      throw new Error('the database went away')
    }) as unknown as Pool
    const real = getDb()
    try {
      vi.mocked(getDb).mockReturnValueOnce(real).mockReturnValueOnce(broken)
      const body = { reading: [{ book: 'pride-and-prejudice', position: { chapter: 'chapter-6', page: 2 }, at: 1 }] }
      expect(await answer(await sync(cookie, body))).toEqual([500, { error: 'failed' }])
      const lines = errors.mock.calls.map((call) => String(call[0]))
      expect(lines).toEqual([expect.stringMatching(/^\[sync\] /)])
      expect(lines.join('\n')).not.toContain('pride-and-prejudice')
      expect(lines.join('\n')).not.toContain('chapter-6')
    } finally {
      errors.mockRestore()
    }
  })
})

describe('time in POST /account/sync', () => {
  const ID = '0f9b8c7e-1d2a-4b3c-8d4e-5f6a7b8c9d0e'
  const today = () => dayIn(new Date(), 'UTC')
  const session = (fields: Record<string, unknown> = {}) => ({
    id: ID,
    kind: 'reading',
    day: today(),
    seconds: 60,
    at: 1000,
    ...fields,
  })
  const stored = (userId: number) =>
    raw<{ id: string; kind: string; day: string; seconds: number }[]>`
      select id, kind, day::text as day, seconds from reading_time where user_id = ${userId} order by day, id`

  it('stores a session and keeps the greater seconds when it comes again', async () => {
    const { user, cookie } = await signedIn()
    expect(await answer(await sync(cookie, { time: [session()] }))).toEqual([200, { ok: true, skipped: 0 }])
    await sync(cookie, { time: [session({ seconds: 30 })] })
    expect(await stored(user.id)).toEqual([{ id: ID, kind: 'reading', day: today(), seconds: 60 }])
    await sync(cookie, { time: [session({ seconds: 90 })] })
    expect((await stored(user.id))[0]?.seconds).toBe(90)
  })

  it('changes nothing for the same id under another day or kind, and counts it skipped', async () => {
    const { user, cookie } = await signedIn()
    await sync(cookie, { time: [session()] })
    expect(await answer(await sync(cookie, { time: [session({ kind: 'listening', seconds: 600 })] }))).toEqual([
      200,
      { ok: true, skipped: 1 },
    ])
    await sync(cookie, { time: [session({ day: addDays(today(), -1), seconds: 600 })] })
    expect(await stored(user.id)).toEqual([{ id: ID, kind: 'reading', day: today(), seconds: 60 }])
  })

  it('skips and counts days 8 back and 2 ahead, and takes 7 back and 1 ahead', async () => {
    const { user, cookie } = await signedIn()
    const id = (n: number) => `0f9b8c7e-1d2a-4b3c-8d4e-5f6a7b8c9d0${n}`
    const response = await sync(cookie, {
      time: [
        session({ id: id(1), day: addDays(today(), -8) }),
        session({ id: id(2), day: addDays(today(), -7) }),
        session({ id: id(3), day: addDays(today(), 1) }),
        session({ id: id(4), day: addDays(today(), 2) }),
      ],
    })
    expect(await answer(response)).toEqual([200, { ok: true, skipped: 2 }])
    expect((await stored(user.id)).map((r) => r.id)).toEqual([id(2), id(3)])
  })

  it('skips the 201st session of a day, while one already stored still grows', async () => {
    const { user, cookie } = await signedIn()
    await sync(cookie, { time: [session()] })
    await raw`
      insert into reading_time (user_id, id, kind, day, seconds)
      select ${user.id}, gen_random_uuid(), 'reading', ${today()}::date, 1 from generate_series(1, 199)`
    const another = session({ id: '1f9b8c7e-1d2a-4b3c-8d4e-5f6a7b8c9d0e' })
    expect(await answer(await sync(cookie, { time: [another, session({ seconds: 120 })] }))).toEqual([
      200,
      { ok: true, skipped: 1 },
    ])
    expect(await raw`select 1 from reading_time where user_id = ${user.id}`).toHaveLength(200)
    expect(await raw`select seconds from reading_time where id = ${ID}`).toEqual([{ seconds: 120 }])
    await sync(cookie, { time: [{ ...another, day: addDays(today(), -1) }] })
    expect(await raw`select 1 from reading_time where user_id = ${user.id}`).toHaveLength(201)
  })

  it('leaves another account’s session with the same id alone', async () => {
    const ada = await signedIn()
    const bob = await signedIn()
    await sync(ada.cookie, { time: [session({ seconds: 600 })] })
    await sync(bob.cookie, { time: [session({ seconds: 30, kind: 'listening' })] })
    expect((await stored(ada.user.id))[0]).toMatchObject({ seconds: 600, kind: 'reading' })
    expect((await stored(bob.user.id))[0]).toMatchObject({ seconds: 30, kind: 'listening' })
  })

  it('keeps the zone on the user, and refuses an invalid zone or id', async () => {
    const { user, cookie } = await signedIn()
    const zone = async () => (await raw`select time_zone from users where id = ${user.id}`)[0]?.time_zone
    expect(await zone()).toBeNull()
    await sync(cookie, { time: [session()], zone: 'Europe/Istanbul' })
    expect(await zone()).toBe('Europe/Istanbul')
    expect(await answer(await sync(cookie, { time: [session()], zone: 'Mars/Olympus' }))).toEqual([
      400,
      { error: 'invalid' },
    ])
    expect(await answer(await sync(cookie, { time: [session({ id: 'x' })] }))).toEqual([400, { error: 'invalid' }])
    await sync(cookie, { time: [session({ day: addDays(today(), -30) })], zone: 'Asia/Kolkata' })
    expect(await zone()).toBe('Asia/Kolkata')
  })

  it('saves places and time sent together', async () => {
    const { user, cookie } = await signedIn()
    const reading = [{ book: 'pride-and-prejudice', position: { chapter: 'chapter-6', page: 2 }, at: 1000 }]
    expect(await answer(await sync(cookie, { reading, time: [session()] }))).toEqual([200, { ok: true, skipped: 0 }])
    expect(await readingFor(db(), user.id, PRIDE)).toMatchObject({ chapter: 'chapter-6', page: 2 })
    expect(await stored(user.id)).toHaveLength(1)
  })

  it('goes with the user, and a log line never holds a day or seconds', async () => {
    const { user, cookie } = await signedIn()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = (() => {
      throw new Error('the database went away')
    }) as unknown as Pool
    const real = getDb()
    try {
      vi.mocked(getDb).mockReturnValueOnce(real).mockReturnValueOnce(broken)
      expect(await answer(await sync(cookie, { time: [session({ seconds: 4321 })] }))).toEqual([
        500,
        { error: 'failed' },
      ])
      const lines = errors.mock.calls.map((call) => String(call[0])).join('\n')
      expect(lines).not.toContain('4321')
      expect(lines).not.toContain(today())
    } finally {
      errors.mockRestore()
    }
    await sync(cookie, { time: [session()] })
    await raw`delete from users where id = ${user.id}`
    expect(await raw`select 1 from reading_time`).toHaveLength(0)
  })
})

describe('the reads', () => {
  it('say signed out without a session', async () => {
    expect(await state(null)).toEqual({ state: 'signed_out' })
    expect(await readingPlaceState(get(null), 'pride-and-prejudice')).toEqual({ state: 'signed_out' })
  })

  it('are ready and empty for a new reader', async () => {
    const { cookie } = await signedIn()
    expect(await state(cookie)).toEqual({ state: 'ready', reading: [], listening: [], settings: null })
    expect(await readingPlaceState(get(cookie), 'pride-and-prejudice')).toEqual({ state: 'ready', place: null })
  })

  it('give at most the newest 50 places and 100 listening positions, leaving out books not in the library', async () => {
    const { user, cookie } = await signedIn()
    await raw`
      insert into reading_places (user_id, book_slug, chapter, page, at, device)
      select ${user.id}, 'gone-book-' || g, 'chapter-1', 1, to_timestamp(g), 'x'
      from generate_series(1, 60) g`
    await raw`
      insert into reading_places (user_id, book_slug, chapter, page, at, device)
      values (${user.id}, 'pride-and-prejudice', 'chapter-1', 1, to_timestamp(100), 'x')`
    await raw`
      insert into listening_places (user_id, book_slug, kind, episode, position_ms, at, device)
      select ${user.id}, 'the-prophet', 'episode', 'ep_' || g, 1000, to_timestamp(g), 'x'
      from generate_series(1, 120) g`
    const found = await ready(cookie)
    expect(found.reading.map((r) => r.book)).toEqual(['pride-and-prejudice'])
    expect(found.listening).toHaveLength(100)
    expect(found.listening[0]).toMatchObject({ episode: 'ep_120', at: 120_000 })
    expect(found.listening.at(-1)).toMatchObject({ episode: 'ep_21' })
  })

  it('fall back to the chapter’s first page, or the book’s, when a page went', async () => {
    const { user, cookie } = await signedIn()
    const book = await privateBook(user.id)
    await raw`
      insert into reading_places (user_id, book_slug, user_book_id, chapter, page, at, device) values
        (${user.id}, 'pride-and-prejudice', null, 'chapter-6', 99, to_timestamp(3), 'x'),
        (${user.id}, 'confessions-of-al-ghazzali', null, null, 999, to_timestamp(2), 'x'),
        (${user.id}, null, ${book.userBookId}, 'gone', 1, to_timestamp(1), 'x')`
    expect((await ready(cookie)).reading.map((r) => r.href)).toEqual([
      '/read/pride-and-prejudice/chapter-6',
      '/read/confessions-of-al-ghazzali/7',
      `/read/${slugOf(book)}/opening`,
    ])
    await raw`update reading_places set chapter = 'opening', page = 5 where user_book_id = ${book.userBookId}`
    expect((await ready(cookie)).reading[2]?.href).toBe(`/read/${slugOf(book)}/opening`)
    await raw`update reading_places set chapter = 'chapter-404' where book_slug = 'pride-and-prejudice'`
    expect((await ready(cookie)).reading[0]?.href).toBe('/read/pride-and-prejudice/chapter-1')
  })

  it('leave out settings stored with a value the lists no longer have', async () => {
    const { user, cookie } = await signedIn()
    await raw`insert into reader_settings (user_id, settings, at, device)
      values (${user.id}, ${raw.json({ ...settings, theme: 'neon' })}, now(), 'x')`
    expect((await ready(cookie)).settings).toBeNull()
  })

  it('give one book’s place, and not found for an unknown book or someone else’s', async () => {
    const alice = await signedIn()
    const bob = await signedIn()
    const hers = await privateBook(alice.user.id)
    await sync(alice.cookie, {
      reading: [{ book: slugOf(hers), position: { chapter: 'second', page: 1 }, at: 5 }],
    })
    expect(await readingPlaceState(get(alice.cookie), slugOf(hers))).toEqual({
      state: 'ready',
      place: expect.objectContaining({ href: `/read/${slugOf(hers)}/second`, label: 'Ch. 2 · p. 1', at: 5 }),
    })
    expect(await readingPlaceState(get(bob.cookie), slugOf(hers))).toEqual({ state: 'not_found' })
    expect(await readingPlaceState(get(bob.cookie), 'no-such-book')).toEqual({ state: 'not_found' })
  })

  it('say unavailable when the database fails, logged as sync read', async () => {
    const { cookie } = await signedIn()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = (() => {
      throw new Error('the database went away')
    }) as unknown as Pool
    const real = getDb()
    try {
      vi.mocked(getDb).mockReturnValueOnce(real).mockReturnValueOnce(broken)
      expect(await state(cookie)).toEqual({ state: 'unavailable' })
      vi.mocked(getDb).mockReturnValueOnce(real).mockReturnValueOnce(broken)
      expect(await readingPlaceState(get(cookie), 'pride-and-prejudice')).toEqual({ state: 'unavailable' })
      expect(errors.mock.calls.map((call) => String(call[0]))).toEqual([
        expect.stringMatching(/^\[sync read\] /),
        expect.stringMatching(/^\[sync read\] /),
      ])
    } finally {
      errors.mockRestore()
    }
  })
})

describe('places', () => {
  it('check a page against the book and load each book once per request', async () => {
    const user = await newUser()
    const book = await privateBook(user.id)
    const slug = slugOf(book)
    const cache = newPlaceCache()
    expect(await resolvePlace(db(), user.id, slug, { chapter: 'second', page: 1 }, cache)).toEqual({
      ref: book,
      bookTitle: 'Notes',
      chapterIndex: 1,
      chapterTitle: 'Second',
      chapter: 'second',
      page: 1,
      href: `/read/${slug}/second`,
      label: 'Ch. 2 · p. 1',
      position: { chapter: 'second', page: 1 },
    })
    expect(cache.size).toBe(1)
    expect(await resolvePlace(db(), user.id, slug, { chapter: 'second', page: 2 }, cache)).toBeNull()
    expect(await resolvePlace(db(), user.id, slug, { printedPage: 1 }, cache)).toBeNull()
    expect(cache.size).toBe(1)
    expect(await placeForRead(db(), user.id, 'no-such-book', 'chapter-1', 1, cache)).toBeNull()
  })

  it('find catalogue episodes, and a private book’s only when it is the user’s audiobook', async () => {
    const user = await newUser()
    expect(await resolveEpisode(db(), user.id, 'the-prophet', 'ep_1')).toEqual({ durationMs: 484_000 })
    expect(await resolveEpisode(db(), user.id, 'the-prophet', 'ep_404')).toBeNull()
    expect(await resolveEpisode(db(), user.id, 'pride-and-prejudice', 'ep_1')).toBeNull()
    expect(
      await resolveEpisode(db(), user.id, privateBookSlug('0f9b8c7e-1d2a-4b3c-8d4e-5f6a7b8c9d0e'), 'ep_1'),
    ).toBeNull()
  })
})
