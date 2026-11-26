import { readFileSync } from 'node:fs'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleBookmarkChange, handleBookmarkCreate } from '~/server/bookmarks/actions'
import { bookBookmarksState } from '~/server/bookmarks/read'
import { createBookmark, deleteBookmark, listForBook, type NewBookmark } from '~/server/bookmarks/store'
import { toBookmarkViews } from '~/server/bookmarks/view'
import { getConfig } from '~/server/config'
import { closeDb, getDb, type Pool } from '~/server/db'
import { NO_DETAILS } from '../../shared/import/details.ts'
import { privateRef } from '../testing/refs'
import { testUser } from '../testing/users'

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
  type BookmarkView,
  MAX_BOOKMARKS_PER_BOOK,
  MAX_BOOKMARKS_PER_USER,
  pageAnchor,
} from '~/shared/bookmarks/bookmarks'
import type { ChapterBook } from '~/shared/content/schema'
import { bookPages } from '~/shared/highlights/page-text'
import { DEFAULT_LIMITS } from '~/shared/limits/limits'
import { databaseUrl, freshDatabase } from '../testing/db'

const raw = postgres(databaseUrl, { max: 1, onnotice: () => {} })
const db = () => getDb()

beforeAll(freshDatabase)
afterAll(async () => {
  await raw.end()
  await closeDb()
})
beforeEach(async () => {
  await raw`truncate users, sessions, login_attempts, api_keys, audit_events, user_books, highlights, bookmarks restart identity cascade`
})

let users = 0
const newUser = () => testUser(db(), `reader-${++users}`, '$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA', 'member')

const PRIDE: BookRef = refFor('pride-and-prejudice')
const CODE_BOOK: BookRef = refFor('fixture-code-book')

const row = (over: Partial<NewBookmark> = {}): NewBookmark => ({
  chapter: 'chapter-6',
  page: 2,
  start: 0,
  end: 12,
  exact: 'Opening text',
  prefix: '',
  suffix: ' goes on',
  ...over,
})

async function created(userId: number, book: BookRef, over: Partial<NewBookmark> = {}) {
  const result = await createBookmark(db(), userId, book, row(over))
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
  await storeChapter(db(), userId, start.id, 0, { title: 'Only', pages: ['<p>one</p>'] }, DEFAULT_LIMITS)
  expect(await finishImport(db(), userId, start.id, null)).toBe('ok')
  return privateRef(start.id)
}

describe('the bookmarks table', () => {
  it('belongs to exactly one book, and refuses out-of-range values', async () => {
    const user = await newUser()
    const insert = (slug: string | null, bookId: string | null, exact = 'x', start = 0, end = 1) =>
      raw`insert into bookmarks (user_id, book_slug, user_book_id, page, start_offset, end_offset, exact)
          values (${user.id}, ${slug}, ${bookId}, 1, ${start}, ${end}, ${exact})`
    await expect(insert(null, null)).rejects.toThrow(/check/)
    const book = await privateBook(user.id)
    await expect(insert('pride-and-prejudice', book.userBookId)).rejects.toThrow(/check/)
    await expect(insert('pride-and-prejudice', null, 'x'.repeat(65))).rejects.toThrow(/check/)
    await expect(insert('pride-and-prejudice', null, 'x', 5, 4)).rejects.toThrow(/check/)
    await insert('pride-and-prejudice', null, '', 0, 0)
    await insert(null, book.userBookId)
  })
})

describe('the store', () => {
  it('creates once per page: the same page again gives the same bookmark', async () => {
    const user = await newUser()
    const first = await created(user.id, PRIDE)
    expect(first.created).toBe(true)
    expect(first.row).toMatchObject({ chapter: 'chapter-6', page: 2, start: 0, end: 12, exact: 'Opening text' })
    const again = await created(user.id, PRIDE, { exact: 'Different now' })
    expect(again).toEqual({ row: first.row, created: false })
    expect((await created(user.id, PRIDE, { page: 3 })).created).toBe(true)
    expect((await created(user.id, CODE_BOOK)).created).toBe(true)
    expect((await listForBook(db(), user.id, PRIDE)).map((b) => b.page)).toEqual([2, 3])
  })

  it('creates once per page of a paged book too, whose chapter is null', async () => {
    const user = await newUser()
    const paged: BookRef = refFor('confessions-of-al-ghazzali')
    const first = await created(user.id, paged, { chapter: null, page: 112 })
    const again = await created(user.id, paged, { chapter: null, page: 112 })
    expect(again).toEqual({ row: first.row, created: false })
    expect(await raw`select 1 from bookmarks`).toHaveLength(1)
    await expect(
      raw`insert into bookmarks (user_id, book_slug, page, start_offset, end_offset, exact)
          values (${user.id}, 'confessions-of-al-ghazzali', 112, 0, 1, 'x')`,
    ).rejects.toThrow(/unique/)
  })

  it('never lets another user see or delete a bookmark, or bookmark their private book', async () => {
    const alice = await newUser()
    const bob = await newUser()
    const mine = await created(alice.id, PRIDE)
    expect(await listForBook(db(), bob.id, PRIDE)).toEqual([])
    expect(await deleteBookmark(db(), bob.id, mine.row.id)).toBe(false)
    expect(await listForBook(db(), alice.id, PRIDE)).toHaveLength(1)

    const book = await privateBook(alice.id)
    expect(await createBookmark(db(), bob.id, book, row())).toBe('missing')
    await created(alice.id, book)
    expect(await listForBook(db(), bob.id, book)).toEqual([])

    expect(await deleteBookmark(db(), alice.id, 'not-a-uuid')).toBe(false)
    expect(await deleteBookmark(db(), alice.id, mine.row.id)).toBe(true)
    expect(await deleteBookmark(db(), alice.id, mine.row.id)).toBe(false)
  })

  it('refuses a bookmark on a private book that is still uploading', async () => {
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
    expect(await createBookmark(db(), user.id, privateRef(start.id), row())).toBe('missing')
  })

  it('deletes a private book’s bookmarks with the book, and every bookmark with the user', async () => {
    const user = await newUser()
    const book = await privateBook(user.id)
    await created(user.id, book)
    await created(user.id, PRIDE)
    expect(await deleteBook(db(), user.id, book.userBookId as string)).toBe(true)
    expect(await raw`select 1 from bookmarks`).toHaveLength(1)
    await raw`delete from users where id = ${user.id}`
    expect(await raw`select 1 from bookmarks`).toHaveLength(0)
  })
})

describe('the limits', () => {
  async function fill(userId: number, slug: string, n: number) {
    await raw`
      insert into bookmarks (user_id, book_slug, chapter, page, start_offset, end_offset, exact)
      select ${userId}, ${slug}, 'chapter-1', 1000 + g, 0, 1, 'x' from generate_series(1, ${n}) g`
  }

  it('allow 1,000 bookmarks per book, counted apart from highlights', async () => {
    const user = await newUser()
    await fill(user.id, 'pride-and-prejudice', MAX_BOOKMARKS_PER_BOOK - 1)
    expect((await created(user.id, PRIDE)).created).toBe(true)
    expect(await createBookmark(db(), user.id, PRIDE, row({ page: 3 }))).toBe('limit-book')
    expect((await created(user.id, PRIDE)).created).toBe(false)
    expect((await created(user.id, CODE_BOOK)).created).toBe(true)
  })

  it('allow 10,000 bookmarks per user across books, and two parallel creates can’t both take the last slot', async () => {
    const user = await newUser()
    for (let i = 0; i < MAX_BOOKMARKS_PER_USER / MAX_BOOKMARKS_PER_BOOK; i++) {
      await fill(user.id, `book-${i}`, MAX_BOOKMARKS_PER_BOOK - (i === 0 ? 1 : 0))
    }
    const results = await Promise.all([
      createBookmark(db(), user.id, PRIDE, row({ page: 1 })),
      createBookmark(db(), user.id, PRIDE, row({ page: 2 })),
    ])
    expect(results.filter((r) => r === 'limit-user')).toHaveLength(1)
    expect(results.filter((r) => typeof r === 'object')).toHaveLength(1)
  })
})

describe('the endpoints', () => {
  const origin = getConfig().appOrigin
  const cookieName = getConfig().cookieSecure ? '__Host-session' : 'session'
  const pride = JSON.parse(readFileSync('tests/e2e/content/books/pride-and-prejudice.json', 'utf8')) as ChapterBook
  const chapter6Page2 = bookPages(pride).find((p) => p.chapterSlug === 'chapter-6' && p.page === 2)
  if (!chapter6Page2) throw new Error('fixture page missing')

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

  const createBody = (over: Record<string, unknown> = {}) => ({
    book: 'pride-and-prejudice',
    position: { chapter: 'chapter-6', page: 2 },
    ...over,
  })

  const create = (cookie: string | null, over: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
    handleBookmarkCreate(post('/account/bookmarks/new', cookie, createBody(over), headers))

  const remove = (cookie: string | null, id: string, body: unknown = { intent: 'delete' }) =>
    handleBookmarkChange(post(`/account/bookmarks/${id}`, cookie, body), id)

  const answer = async (response: Response) => [
    response.status,
    response.status === 403 ? null : (((await response.json()) as { error?: string }).error ?? null),
  ]

  it('bookmarks a page with the server’s own anchor: 201, then 200 with the same bookmark', async () => {
    const { cookie } = await signedIn()
    const response = await create(cookie)
    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const { bookmark } = (await response.json()) as { bookmark: BookmarkView }
    const anchor = pageAnchor(chapter6Page2.text)
    expect(bookmark).toMatchObject({
      status: 'ok',
      opening: anchor.exact.replace(/\s+/g, ' ').trim(),
      place: {
        chapter: 'chapter-6',
        page: 2,
        pageHref: '/read/pride-and-prejudice/chapter-6/2',
        label: 'Ch. 6 · p. 2',
      },
    })
    expect(bookmark).not.toHaveProperty('prefix')
    expect(bookmark).not.toHaveProperty('start')
    const [stored] = await raw<{ exact: string; prefix: string; suffix: string; start_offset: number }[]>`
      select exact, prefix, suffix, start_offset from bookmarks`
    expect(stored).toEqual({
      exact: anchor.exact,
      prefix: anchor.prefix,
      suffix: anchor.suffix,
      start_offset: anchor.start,
    })

    const again = await create(cookie)
    expect(again.status).toBe(200)
    expect(((await again.json()) as { bookmark: BookmarkView }).bookmark.id).toBe(bookmark.id)
    expect(await raw`select 1 from bookmarks`).toHaveLength(1)

    const deleted = await remove(cookie, bookmark.id)
    expect([deleted.status, await deleted.json()]).toEqual([200, { ok: true }])
    expect(await answer(await remove(cookie, bookmark.id))).toEqual([404, 'not_found'])
  })

  it('maps every refusal to its status and code', async () => {
    const { cookie } = await signedIn()
    expect(await answer(await create(null))).toEqual([401, 'signed_out'])
    expect(await answer(await create(cookie, { book: 'no-such-book' }))).toEqual([404, 'not_found'])
    expect(await answer(await create(cookie, { text: 'trust me' }))).toEqual([400, 'invalid'])
    expect(await answer(await create(cookie, { position: { chapter: 'chapter-6', page: 99 } }))).toEqual([
      400,
      'invalid',
    ])
    expect(await answer(await create(cookie, { position: { printedPage: 2 } }))).toEqual([400, 'invalid'])
    const notJson = post('/account/bookmarks/new', cookie, 'not json')
    expect(await answer(await handleBookmarkCreate(notJson))).toEqual([400, 'invalid'])

    const id = '6f1c0000-0000-4000-8000-000000000000'
    expect(await answer(await remove(cookie, 'not-a-uuid'))).toEqual([404, 'not_found'])
    expect(await answer(await remove(null, id))).toEqual([401, 'signed_out'])
    expect(await answer(await remove(cookie, id, { intent: 'update' }))).toEqual([400, 'invalid'])
    expect(await answer(await remove(cookie, id))).toEqual([404, 'not_found'])
  })

  it('says quota with its scope and limit', async () => {
    const { user, cookie } = await signedIn()
    await raw`
      insert into bookmarks (user_id, book_slug, chapter, page, start_offset, end_offset, exact)
      select ${user.id}, 'pride-and-prejudice', 'chapter-1', 1000 + g, 0, 1, 'x'
      from generate_series(1, ${MAX_BOOKMARKS_PER_BOOK}) g`
    const inBook = await create(cookie)
    expect([inBook.status, await inBook.json()]).toEqual([
      409,
      { error: 'quota', scope: 'book', max: MAX_BOOKMARKS_PER_BOOK },
    ])

    const other = await signedIn()
    await raw`
      insert into bookmarks (user_id, book_slug, chapter, page, start_offset, end_offset, exact)
      select ${other.user.id}, 'book-' || (g / ${MAX_BOOKMARKS_PER_BOOK}), 'chapter-1', g, 0, 1, 'x'
      from generate_series(1, ${MAX_BOOKMARKS_PER_USER}) g`
    const inAll = await create(other.cookie)
    expect([inAll.status, await inAll.json()]).toEqual([
      409,
      { error: 'quota', scope: 'user', max: MAX_BOOKMARKS_PER_USER },
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
      expect(await answer(await create(cookie))).toEqual([500, 'failed'])
      vi.mocked(getDb).mockReturnValueOnce(real).mockReturnValueOnce(broken)
      expect(await answer(await remove(cookie, '6f1c0000-0000-4000-8000-000000000000'))).toEqual([500, 'failed'])
      const lines = errors.mock.calls.map((call) => String(call[0]))
      expect(lines).toEqual([
        expect.stringMatching(/^\[bookmark create\] /),
        expect.stringMatching(/^\[bookmark change\] /),
      ])
      expect(lines.join('\n')).not.toContain('pride-and-prejudice')
    } finally {
      errors.mockRestore()
    }
  })

  it('reads the open book’s bookmarks: signed out, not found, ready, and unavailable when the database fails', async () => {
    const alice = await signedIn()
    const bob = await signedIn()
    const read = (cookie: string | null, book: string) =>
      bookBookmarksState(new Request(`${origin}/`, { headers: cookie ? { cookie } : {} }), book)
    expect(await read(null, 'pride-and-prejudice')).toEqual({ state: 'signed_out' })
    expect(await read(alice.cookie, 'no-such-book')).toEqual({ state: 'not_found' })
    const mine = await privateBook(alice.user.id)
    expect(await read(bob.cookie, slugOf(mine))).toEqual({ state: 'not_found' })
    expect(await read(alice.cookie, 'pride-and-prejudice')).toEqual({ state: 'ready', bookmarks: [] })
    const { bookmark } = (await (await create(alice.cookie)).json()) as { bookmark: BookmarkView }
    expect(await read(alice.cookie, 'pride-and-prejudice')).toEqual({ state: 'ready', bookmarks: [bookmark] })

    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = (() => {
      throw new Error('the database went away')
    }) as unknown as Pool
    try {
      vi.mocked(getDb).mockReturnValueOnce(getDb()).mockReturnValueOnce(broken)
      expect(await read(alice.cookie, 'pride-and-prejudice')).toEqual({ state: 'unavailable' })
      expect(String(errors.mock.calls[0]?.[0])).toMatch(/^\[book bookmarks\] /)
    } finally {
      errors.mockRestore()
    }
  })

  it('answers 404 to another user, for bookmarks and private books alike', async () => {
    const alice = await signedIn()
    const bob = await signedIn()
    const { bookmark } = (await (await create(alice.cookie)).json()) as { bookmark: BookmarkView }
    expect(await answer(await remove(bob.cookie, bookmark.id))).toEqual([404, 'not_found'])
    expect(await listForBook(db(), alice.user.id, PRIDE)).toHaveLength(1)

    const book = await privateBook(alice.user.id)
    const privateBody = { book: slugOf(book), position: { chapter: 'only', page: 1 } }
    const own = await create(alice.cookie, privateBody)
    expect(own.status).toBe(201)
    expect(((await own.json()) as { bookmark: BookmarkView }).bookmark).toMatchObject({
      opening: 'one',
      place: { label: 'Ch. 1 · p. 1' },
    })
    expect(await answer(await create(bob.cookie, privateBody))).toEqual([404, 'not_found'])
  })
})

describe('the view', () => {
  it('opens a bookmark where its words are now, and lists one found nowhere as missing', async () => {
    const user = await newUser()
    const book = await openBook(db(), user.id, 'pride-and-prejudice')
    const page2 = (book?.format === 'text' ? await book.pages() : [])?.find(
      (p) => p.chapterSlug === 'chapter-6' && p.page === 2,
    )
    if (book?.format !== 'text' || !page2) throw new Error('fixture page missing')
    await created(user.id, PRIDE, { chapter: 'chapter-6', page: 1, ...pageAnchor(page2.text) })
    await created(user.id, PRIDE, { page: 3, start: 0, end: 23, exact: 'Words in no book at all', suffix: '' })
    const [moved, missing] = toBookmarkViews(await listForBook(db(), user.id, PRIDE), await book.pages())
    expect(moved).toMatchObject({ status: 'moved', place: { pageHref: '/read/pride-and-prejudice/chapter-6/2' } })
    expect(missing).toMatchObject({ status: 'missing', place: null, opening: 'Words in no book at all' })
  })
})
