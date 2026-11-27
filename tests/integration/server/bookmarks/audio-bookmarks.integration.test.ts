import { readFileSync } from 'node:fs'
import { afterAll, describe, expect, vi } from 'vitest'
import {
  audioBookmarksState,
  handleAudioBookmarkChange,
  handleAudioBookmarkCreate,
} from '~/server/bookmarks/audio-actions'
import {
  type AudioBookmarkRow,
  createAudioBookmark,
  deleteAudioBookmark,
  listAudioForBook,
  type NewAudioBookmark,
} from '~/server/bookmarks/audio-store'
import { toAudioBookmarkViews } from '~/server/bookmarks/audio-view'
import { getConfig } from '~/server/config'
import { closeDb, getDb, type Pool } from '~/server/db'
import { privateBookSlug } from '~/shared/content/book-slug'
import { NO_DETAILS } from '~/shared/import/details.ts'
import { it, raw } from '../../../support/server/db-test'
import { privateRef } from '../../../support/server/refs'
import { testUser } from '../../../support/server/users'

vi.mock('~/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/server/db')>()
  return { ...actual, getDb: vi.fn(actual.getDb) }
})

import { openBook } from '~/server/books/book'
import { type BookRef, refFor, slugOf } from '~/server/books/ref'
import { hashToken, newSessionToken } from '~/server/security'
import { createSession } from '~/server/sessions'
import { deleteBook, finishImport, startImport, storeChapter } from '~/server/user-books'
import {
  type AudioBookmarkView,
  MAX_AUDIO_BOOKMARKS_PER_BOOK,
  MAX_AUDIO_BOOKMARKS_PER_USER,
  momentAnchor,
} from '~/shared/bookmarks/audio'
import type { ChapterBook } from '~/shared/content/schema'
import { bookPages } from '~/shared/highlights/page-text'
import { DEFAULT_LIMITS } from '~/shared/limits/limits'
import { readyAudiobook } from '../../../support/server/audiobooks'

const db = () => getDb()

afterAll(async () => {
  await closeDb()
})

let users = 0
const newUser = () => testUser(db(), `listener-${++users}`, '$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA', 'member')

const PRIDE: BookRef = refFor('pride-and-prejudice')
const PROPHET: BookRef = refFor('the-prophet')
const PAGED: BookRef = refFor('confessions-of-al-ghazzali')

const voice = (over: Partial<Extract<NewAudioBookmark, { kind: 'voice' }>> = {}): NewAudioBookmark => ({
  kind: 'voice',
  chapter: 'chapter-6',
  page: 2,
  start: 120,
  end: 184,
  exact: 'The sentence being read',
  prefix: 'before it ',
  suffix: ' and after',
  ...over,
})
const episode = (over: Partial<Extract<NewAudioBookmark, { kind: 'episode' }>> = {}): NewAudioBookmark => ({
  kind: 'episode',
  episode: 'the-prophet-01',
  positionMs: 15_000,
  ...over,
})

async function created(userId: number, book: BookRef, moment: NewAudioBookmark) {
  const result = await createAudioBookmark(db(), userId, book, moment)
  if (typeof result === 'string') throw new Error(result)
  return result
}

async function privateBook(userId: number): Promise<BookRef> {
  const start = await startImport(
    db(),
    userId,
    {
      title: 'Notes',
      author: 'Ada',
      language: 'en',
      details: NO_DETAILS,
      chapterCount: 1,
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
    { title: 'Only', pages: ['<p>One sentence. Another one.</p>'] },
    DEFAULT_LIMITS,
  )
  expect(await finishImport(db(), userId, start.id, null)).toBe('ok')
  return privateRef(start.id)
}

describe('the audio_bookmarks table', () => {
  it('belongs to exactly one book, and holds only its kind’s fields', async () => {
    const user = await newUser()
    const book = await privateBook(user.id)
    const insertVoice = (slug: string | null, bookId: string | null, exact: string | null = 'x') =>
      raw`insert into audio_bookmarks
            (user_id, book_slug, user_book_id, kind, page, start_offset, end_offset, exact, prefix, suffix)
          values (${user.id}, ${slug}, ${bookId}, 'voice', 1, 0, 1, ${exact}, '', '')`
    await expect(insertVoice(null, null)).rejects.toThrow(/check/)
    await expect(insertVoice('pride-and-prejudice', book.userBookId)).rejects.toThrow(/check/)
    await expect(insertVoice('pride-and-prejudice', null, null)).rejects.toThrow(/check/)
    await expect(insertVoice('pride-and-prejudice', null, '')).rejects.toThrow(/check/)
    await expect(insertVoice('pride-and-prejudice', null, 'x'.repeat(65))).rejects.toThrow(/check/)
    await expect(
      raw`insert into audio_bookmarks (user_id, book_slug, kind, page) values (${user.id}, 'pride-and-prejudice', 'voice', 1)`,
    ).rejects.toThrow(/check/)
    await raw`insert into audio_bookmarks (user_id, user_book_id, kind, episode, position_ms)
          values (${user.id}, ${book.userBookId}, 'episode', 'e1', 0)`
    await expect(
      raw`insert into audio_bookmarks (user_id, kind, episode, position_ms) values (${user.id}, 'episode', 'e1', 0)`,
    ).rejects.toThrow(/check/)
    await expect(
      raw`insert into audio_bookmarks (user_id, book_slug, kind, episode, position_ms, page)
          values (${user.id}, 'the-prophet', 'episode', 'e1', 0, 1)`,
    ).rejects.toThrow(/check/)
    await expect(
      raw`insert into audio_bookmarks (user_id, book_slug, kind, episode, position_ms)
          values (${user.id}, 'the-prophet', 'episode', 'e1', -1)`,
    ).rejects.toThrow(/check/)
    await expect(
      raw`insert into audio_bookmarks (user_id, book_slug, kind) values (${user.id}, 'the-prophet', 'chapter')`,
    ).rejects.toThrow(/check/)
    await insertVoice('pride-and-prejudice', null)
    await insertVoice(null, book.userBookId)
  })
})

describe('the store', () => {
  it('creates once per sentence: the same sentence again gives the same bookmark', async () => {
    const user = await newUser()
    const first = await created(user.id, PRIDE, voice())
    expect(first.created).toBe(true)
    expect(first.row).toMatchObject({
      kind: 'voice',
      chapter: 'chapter-6',
      page: 2,
      start: 120,
      exact: 'The sentence being read',
    })
    const again = await created(user.id, PRIDE, voice({ exact: 'Different words now' }))
    expect(again).toEqual({ row: first.row, created: false })
    expect((await created(user.id, PRIDE, voice({ start: 300, end: 364 }))).created).toBe(true)
    expect((await created(user.id, PROPHET, voice())).created).toBe(true)
    expect((await listAudioForBook(db(), user.id, PRIDE)).map((b) => (b as { start: number }).start)).toEqual([
      120, 300,
    ])
  })

  it('creates once per sentence of a paged book too, whose chapter is null', async () => {
    const user = await newUser()
    const first = await created(user.id, PAGED, voice({ chapter: null, page: 39 }))
    expect(await created(user.id, PAGED, voice({ chapter: null, page: 39 }))).toEqual({
      row: first.row,
      created: false,
    })
    expect(await raw`select 1 from audio_bookmarks`).toHaveLength(1)
    await expect(
      raw`insert into audio_bookmarks
            (user_id, book_slug, kind, page, start_offset, end_offset, exact, prefix, suffix)
          values (${user.id}, 'confessions-of-al-ghazzali', 'voice', 39, 120, 121, 'x', '', '')`,
    ).rejects.toThrow(/unique/)
  })

  it('creates once per episode second', async () => {
    const user = await newUser()
    const first = await created(user.id, PROPHET, episode())
    expect(first.row).toMatchObject({ kind: 'episode', episode: 'the-prophet-01', positionMs: 15_000 })
    expect(await created(user.id, PROPHET, episode())).toEqual({ row: first.row, created: false })
    expect((await created(user.id, PROPHET, episode({ positionMs: 16_000 }))).created).toBe(true)
    expect((await created(user.id, PROPHET, episode({ episode: 'the-prophet-02' }))).created).toBe(true)
    expect((await created(user.id, PROPHET, voice())).created).toBe(true)
    expect(await listAudioForBook(db(), user.id, PROPHET)).toHaveLength(4)
    await expect(
      raw`insert into audio_bookmarks (user_id, book_slug, kind, episode, position_ms)
          values (${user.id}, 'the-prophet', 'episode', 'the-prophet-01', 15000)`,
    ).rejects.toThrow(/unique/)
  })

  it('never lets another user see or delete an audio bookmark, or bookmark their private book', async () => {
    const alice = await newUser()
    const bob = await newUser()
    const mine = await created(alice.id, PRIDE, voice())
    expect(await listAudioForBook(db(), bob.id, PRIDE)).toEqual([])
    expect(await deleteAudioBookmark(db(), bob.id, mine.row.id)).toBe(false)
    expect(await listAudioForBook(db(), alice.id, PRIDE)).toHaveLength(1)

    const book = await privateBook(alice.id)
    expect(await createAudioBookmark(db(), bob.id, book, voice({ chapter: 'only', page: 1, start: 0 }))).toBe('missing')
    await created(alice.id, book, voice({ chapter: 'only', page: 1, start: 0 }))
    expect(await listAudioForBook(db(), bob.id, book)).toEqual([])

    expect(await deleteAudioBookmark(db(), alice.id, 'not-a-uuid')).toBe(false)
    expect(await deleteAudioBookmark(db(), alice.id, mine.row.id)).toBe(true)
    expect(await deleteAudioBookmark(db(), alice.id, mine.row.id)).toBe(false)
  })

  it('refuses one on a private book that is still uploading', async () => {
    const user = await newUser()
    const start = await startImport(
      db(),
      user.id,
      {
        title: 'N',
        author: 'A',
        language: 'en',
        details: NO_DETAILS,
        chapterCount: 1,
      },
      new Date(),
      DEFAULT_LIMITS,
    )
    if (!start.ok) throw new Error('could not start')
    expect(await createAudioBookmark(db(), user.id, privateRef(start.id), voice())).toBe('missing')
  })

  it('deletes a private book’s audio bookmarks with the book, and every one with the user', async () => {
    const user = await newUser()
    const book = await privateBook(user.id)
    await created(user.id, book, voice({ chapter: 'only', page: 1, start: 0 }))
    await created(user.id, PROPHET, episode())
    expect(await deleteBook(db(), user.id, book.userBookId as string)).toBe(true)
    expect(await raw`select 1 from audio_bookmarks`).toHaveLength(1)
    await raw`delete from users where id = ${user.id}`
    expect(await raw`select 1 from audio_bookmarks`).toHaveLength(0)
  })

  it('lists oldest first, each row as its kind', async () => {
    const user = await newUser()
    const a = await created(user.id, PROPHET, episode())
    const b = await created(user.id, PROPHET, voice({ chapter: 'on-love', page: 1, start: 0 }))
    const rows: AudioBookmarkRow[] = await listAudioForBook(db(), user.id, PROPHET)
    expect(rows.map((r) => [r.id, r.kind])).toEqual([
      [a.row.id, 'episode'],
      [b.row.id, 'voice'],
    ])
  })
})

describe('the limits', () => {
  async function fill(userId: number, slug: string, n: number) {
    await raw`
      insert into audio_bookmarks (user_id, book_slug, kind, episode, position_ms)
      select ${userId}, ${slug}, 'episode', 'filler', 1000 * g from generate_series(1, ${n}) g`
  }

  it('allow 1,000 audio bookmarks per book, counted apart from page bookmarks and highlights', async () => {
    const user = await newUser()
    await raw`
      insert into bookmarks (user_id, book_slug, chapter, page, start_offset, end_offset, exact)
      select ${user.id}, 'pride-and-prejudice', 'chapter-1', g, 0, 1, 'x' from generate_series(1, 5) g`
    await fill(user.id, 'pride-and-prejudice', MAX_AUDIO_BOOKMARKS_PER_BOOK - 1)
    expect((await created(user.id, PRIDE, voice())).created).toBe(true)
    expect(await createAudioBookmark(db(), user.id, PRIDE, voice({ start: 400, end: 464 }))).toBe('limit-book')
    expect((await created(user.id, PRIDE, voice())).created).toBe(false)
    expect((await created(user.id, PROPHET, episode())).created).toBe(true)
  })

  it('allow 10,000 per user across books, and two parallel creates can’t both take the last slot', async () => {
    const user = await newUser()
    for (let i = 0; i < MAX_AUDIO_BOOKMARKS_PER_USER / MAX_AUDIO_BOOKMARKS_PER_BOOK; i++) {
      await fill(user.id, `book-${i}`, MAX_AUDIO_BOOKMARKS_PER_BOOK - (i === 0 ? 1 : 0))
    }
    const results = await Promise.all([
      createAudioBookmark(db(), user.id, PRIDE, voice({ start: 1, end: 65 })),
      createAudioBookmark(db(), user.id, PRIDE, voice({ start: 2, end: 66 })),
    ])
    expect(results.filter((r) => r === 'limit-user')).toHaveLength(1)
    expect(results.filter((r) => typeof r === 'object')).toHaveLength(1)
  })
})

describe('the endpoints', () => {
  const origin = getConfig().appOrigin
  const cookieName = getConfig().cookieSecure ? '__Host-session' : 'session'
  const pride = JSON.parse(readFileSync('tests/fixtures/content/books/pride-and-prejudice.json', 'utf8')) as ChapterBook
  const found = bookPages(pride).find((p) => p.chapterSlug === 'chapter-6' && p.page === 2)
  if (!found) throw new Error('fixture page missing')
  const page2 = found
  const offset = page2.text.indexOf('. ') + 2

  async function signedIn() {
    const user = await newUser()
    const token = newSessionToken()
    await createSession(db(), { tokenHash: hashToken(token), userId: user.id, ip: null, userAgent: 'test' })
    return { user, cookie: `${cookieName}=${token}` }
  }

  const post = (path: string, cookie: string | null, body: unknown, headers: Record<string, string> = {}) =>
    new Request(`${origin}${path}`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })

  const voiceBody = (over: Record<string, unknown> = {}) => ({
    book: 'pride-and-prejudice',
    kind: 'voice',
    position: { chapter: 'chapter-6', page: 2 },
    offset,
    ...over,
  })
  const episodeBody = (over: Record<string, unknown> = {}) => ({
    book: 'the-prophet',
    kind: 'episode',
    episode: 'ep_1',
    positionMs: 15_500,
    ...over,
  })

  const create = (cookie: string | null, body: unknown, headers: Record<string, string> = {}) =>
    handleAudioBookmarkCreate(post('/account/bookmarks/audio/new', cookie, body, headers))
  const remove = (cookie: string | null, id: string, body: unknown = { intent: 'delete' }) =>
    handleAudioBookmarkChange(post(`/account/bookmarks/audio/${id}`, cookie, body), id)
  const answer = async (response: Response) => [
    response.status,
    response.status === 403 ? null : (((await response.json()) as { error?: string }).error ?? null),
  ]
  const bookmarkOf = async (response: Response) => ((await response.json()) as { bookmark: AudioBookmarkView }).bookmark

  it('bookmarks the sentence with the server’s own anchor: 201, then 200 with the same bookmark', async () => {
    const { cookie } = await signedIn()
    const response = await create(cookie, voiceBody())
    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const bookmark = await bookmarkOf(response)
    const anchor = momentAnchor(page2.text, offset)
    if (!anchor) throw new Error('no anchor')
    expect(bookmark).toMatchObject({
      kind: 'voice',
      status: 'ok',
      opening: anchor.exact.replace(/\s+/g, ' ').trim(),
      place: { chapter: 'chapter-6', page: 2, label: 'Ch. 6 · p. 2', start: anchor.start },
    })
    expect(bookmark).not.toHaveProperty('prefix')
    const [stored] = await raw<{ exact: string; prefix: string; suffix: string; start_offset: number }[]>`
      select exact, prefix, suffix, start_offset from audio_bookmarks`
    expect(stored).toEqual({
      exact: anchor.exact,
      prefix: anchor.prefix,
      suffix: anchor.suffix,
      start_offset: anchor.start,
    })

    const again = await create(cookie, voiceBody())
    expect(again.status).toBe(200)
    expect((await bookmarkOf(again)).id).toBe(bookmark.id)
    expect(await raw`select 1 from audio_bookmarks`).toHaveLength(1)

    const deleted = await remove(cookie, bookmark.id)
    expect([deleted.status, await deleted.json()]).toEqual([200, { ok: true }])
    expect(await answer(await remove(cookie, bookmark.id))).toEqual([404, 'not_found'])
  })

  it('bookmarks an episode at the whole second, idempotently', async () => {
    const { cookie } = await signedIn()
    const first = await create(cookie, episodeBody())
    expect(first.status).toBe(201)
    expect(await bookmarkOf(first)).toMatchObject({
      kind: 'episode',
      status: 'ok',
      positionMs: 15_000,
      episode: { id: 'ep_1', number: 1, title: 'The Coming of the Ship' },
    })
    expect((await create(cookie, episodeBody({ positionMs: 15_999 }))).status).toBe(200)
    expect((await create(cookie, episodeBody({ positionMs: 484_000 }))).status).toBe(201)
  })

  it('maps every refusal to its status and code', async () => {
    const { cookie } = await signedIn()
    expect(await answer(await create(null, voiceBody()))).toEqual([401, 'signed_out'])
    expect(await answer(await create(cookie, voiceBody({ text: 'trust me' })))).toEqual([400, 'invalid'])
    expect(await answer(await create(cookie, 'not json'))).toEqual([400, 'invalid'])
    expect(await answer(await create(cookie, voiceBody({ book: 'no-such-book' })))).toEqual([404, 'not_found'])
    const noPage = voiceBody({ position: { chapter: 'chapter-6', page: 99 } })
    expect(await answer(await create(cookie, noPage))).toEqual([400, 'invalid'])
    expect(await answer(await create(cookie, voiceBody({ offset: page2.text.length })))).toEqual([400, 'invalid'])
    const noAudio = episodeBody({ book: 'pride-and-prejudice' })
    expect(await answer(await create(cookie, noAudio))).toEqual([404, 'not_found'])
    const privateBook = episodeBody({ book: privateBookSlug('6f1c0000-0000-4000-8000-000000000000') })
    expect(await answer(await create(cookie, privateBook))).toEqual([404, 'not_found'])
    expect(await answer(await create(cookie, episodeBody({ episode: 'ep_99' })))).toEqual([400, 'invalid'])
    expect(await answer(await create(cookie, episodeBody({ positionMs: 484_001 })))).toEqual([400, 'invalid'])

    const id = '6f1c0000-0000-4000-8000-000000000000'
    expect(await answer(await remove(cookie, 'not-a-uuid'))).toEqual([404, 'not_found'])
    expect(await answer(await remove(null, id))).toEqual([401, 'signed_out'])
    expect(await answer(await remove(cookie, id, { intent: 'update' }))).toEqual([400, 'invalid'])
    expect(await answer(await remove(cookie, id))).toEqual([404, 'not_found'])
  })

  it('says quota with its scope and limit', async () => {
    const { user, cookie } = await signedIn()
    await raw`
      insert into audio_bookmarks (user_id, book_slug, kind, episode, position_ms)
      select ${user.id}, 'the-prophet', 'episode', 'filler', 1000 * g
      from generate_series(1, ${MAX_AUDIO_BOOKMARKS_PER_BOOK}) g`
    const inBook = await create(cookie, episodeBody())
    expect([inBook.status, await inBook.json()]).toEqual([
      409,
      { error: 'quota', scope: 'book', max: MAX_AUDIO_BOOKMARKS_PER_BOOK },
    ])

    const other = await signedIn()
    await raw`
      insert into audio_bookmarks (user_id, book_slug, kind, episode, position_ms)
      select ${other.user.id}, 'book-' || (g / ${MAX_AUDIO_BOOKMARKS_PER_BOOK}), 'episode', 'filler', 1000 * g
      from generate_series(1, ${MAX_AUDIO_BOOKMARKS_PER_USER}) g`
    const inAll = await create(other.cookie, voiceBody())
    expect([inAll.status, await inAll.json()]).toEqual([
      409,
      { error: 'quota', scope: 'user', max: MAX_AUDIO_BOOKMARKS_PER_USER },
    ])
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
      expect(await answer(await create(cookie, voiceBody()))).toEqual([500, 'failed'])
      vi.mocked(getDb).mockReturnValueOnce(real).mockReturnValueOnce(broken)
      expect(await answer(await remove(cookie, '6f1c0000-0000-4000-8000-000000000000'))).toEqual([500, 'failed'])
      vi.mocked(getDb).mockReturnValueOnce(real).mockReturnValueOnce(broken)
      expect(await audioBookmarksState(post('/x', cookie, {}), 'the-prophet')).toEqual({ state: 'unavailable' })
      const lines = errors.mock.calls.map((call) => String(call[0]))
      expect(lines).toEqual([
        expect.stringMatching(/^\[audio bookmark create\] /),
        expect.stringMatching(/^\[audio bookmark change\] /),
        expect.stringMatching(/^\[audio bookmarks\] /),
      ])
      expect(lines.join('\n')).not.toContain('pride-and-prejudice')
    } finally {
      errors.mockRestore()
    }
  })

  it('answers 404 to another user, for audio bookmarks and private books alike', async () => {
    const alice = await signedIn()
    const bob = await signedIn()
    const bookmark = await bookmarkOf(await create(alice.cookie, voiceBody()))
    expect(await answer(await remove(bob.cookie, bookmark.id))).toEqual([404, 'not_found'])
    expect(await listAudioForBook(db(), alice.user.id, PRIDE)).toHaveLength(1)

    const book = await privateBook(alice.user.id)
    const privateBody = voiceBody({
      book: slugOf(book),
      position: { chapter: 'only', page: 1 },
      offset: 0,
    })
    const own = await create(alice.cookie, privateBody)
    expect(own.status).toBe(201)
    expect(await bookmarkOf(own)).toMatchObject({
      opening: 'One sentence. Another one.',
      place: { label: 'Ch. 1 · p. 1' },
    })
    expect(await answer(await create(bob.cookie, privateBody))).toEqual([404, 'not_found'])
  })

  it('bookmarks a chapter of the reader’s own audiobook, and lists it, but not another reader’s', async () => {
    const alice = await signedIn()
    const bob = await signedIn()
    const id = await readyAudiobook(raw, alice.user.id, [60_000, 90_000])
    const slug = privateBookSlug(id)
    const response = await create(alice.cookie, episodeBody({ book: slug, episode: '2', positionMs: 12_345 }))
    expect(response.status).toBe(201)
    expect(await bookmarkOf(response)).toMatchObject({
      kind: 'episode',
      status: 'ok',
      positionMs: 12_000,
      episode: { id: '2', number: 2, title: 'Chapter 2', durationMs: 90_000 },
    })
    expect(await answer(await create(alice.cookie, episodeBody({ book: slug, episode: '3' })))).toEqual([
      400,
      'invalid',
    ])
    const past = episodeBody({ book: slug, episode: '1', positionMs: 60_001 })
    expect(await answer(await create(alice.cookie, past))).toEqual([400, 'invalid'])
    expect(await answer(await create(bob.cookie, episodeBody({ book: slug, episode: '1' })))).toEqual([
      404,
      'not_found',
    ])
    const voice = voiceBody({ book: slug, position: { chapter: 'chapter-1', page: 1 }, offset: 0 })
    expect(await answer(await create(alice.cookie, voice))).toEqual([404, 'not_found'])
    const read = (cookie: string) =>
      audioBookmarksState(new Request(`${origin}/read/${slug}`, { headers: { cookie } }), slug)
    expect(await read(alice.cookie)).toMatchObject({
      state: 'ready',
      bookmarks: [{ kind: 'episode', positionMs: 12_000, episode: { id: '2' } }],
    })
    expect(await read(bob.cookie)).toEqual({ state: 'not_found' })
  })

  describe('the read', () => {
    const read = (cookie: string | null, slug: string) =>
      audioBookmarksState(new Request(`${origin}/read/${slug}`, { headers: cookie ? { cookie } : {} }), slug)

    it('says signed out, and not found for an unknown book or someone else’s', async () => {
      const alice = await signedIn()
      const bob = await signedIn()
      expect(await read(null, 'the-prophet')).toEqual({ state: 'signed_out' })
      expect(await read(alice.cookie, 'no-such-book')).toEqual({ state: 'not_found' })
      const book = await privateBook(alice.user.id)
      expect(await read(bob.cookie, slugOf(book))).toEqual({ state: 'not_found' })
    })

    it('lists both kinds on a book with an audiobook, read aloud first', async () => {
      const { cookie } = await signedIn()
      await create(cookie, episodeBody())
      await create(cookie, voiceBody({ book: 'the-prophet', position: { chapter: 'on-love', page: 1 }, offset: 0 }))
      const state = await read(cookie, 'the-prophet')
      if (state.state !== 'ready') throw new Error(state.state)
      expect(state.bookmarks.map((b) => [b.kind, b.status])).toEqual([
        ['voice', 'ok'],
        ['episode', 'ok'],
      ])
    })

    it('lists only read-aloud bookmarks on a private book', async () => {
      const { user, cookie } = await signedIn()
      const book = await privateBook(user.id)
      const slug = slugOf(book)
      await create(cookie, voiceBody({ book: slug, position: { chapter: 'only', page: 1 }, offset: 0 }))
      expect(await read(cookie, slug)).toMatchObject({
        state: 'ready',
        bookmarks: [{ kind: 'voice', place: { label: 'Ch. 1 · p. 1' } }],
      })
    })
  })
})

describe('the view', () => {
  it('finds a sentence where its words are now, and lists one found nowhere, or a gone episode, as missing', async () => {
    const user = await newUser()
    const book = await openBook(db(), user.id, 'pride-and-prejudice')
    const page2 = (book?.format === 'text' ? await book.pages() : [])?.find(
      (p) => p.chapterSlug === 'chapter-6' && p.page === 2,
    )
    if (book?.format !== 'text' || !page2) throw new Error('fixture page missing')
    const anchor = momentAnchor(page2.text, page2.text.indexOf('. ') + 2)
    if (!anchor) throw new Error('no anchor')
    await created(user.id, PRIDE, { kind: 'voice', chapter: 'chapter-6', page: 1, ...anchor })
    const nowhere = { page: 3, start: 0, end: 23, exact: 'Words in no book at all', prefix: '', suffix: '' }
    await created(user.id, PRIDE, voice(nowhere))
    await created(user.id, PRIDE, episode({ episode: 'gone' }))
    const views = toAudioBookmarkViews(await listAudioForBook(db(), user.id, PRIDE), await book.pages(), null)
    expect(views).toHaveLength(3)
    expect(views).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'voice',
          status: 'moved',
          place: expect.objectContaining({ pageHref: '/read/pride-and-prejudice/chapter-6/2', start: anchor.start }),
        }),
        expect.objectContaining({ kind: 'voice', status: 'missing', place: null, opening: 'Words in no book at all' }),
        expect.objectContaining({ kind: 'episode', status: 'missing', episode: null }),
      ]),
    )
  })
})
