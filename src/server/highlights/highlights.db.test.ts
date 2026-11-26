import { readFileSync } from 'node:fs'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NO_DETAILS } from '../../shared/import/details.ts'
import { privateRef } from '../testing/refs'
import { testUser } from '../testing/users'

vi.mock('~/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/server/db')>()
  return { ...actual, getDb: vi.fn(actual.getDb) }
})

import { type BookRef, refFor, slugOf } from '~/server/books/ref'
import { getConfig } from '~/server/config'
import { closeDb, getDb, type Pool } from '~/server/db'
import { handleChange, handleCreate, handleHighlightsForm } from '~/server/highlights/actions'
import { handleExport, handleExportAll } from '~/server/highlights/export'
import { highlightsPageState } from '~/server/highlights/page'
import { bookHighlightsState } from '~/server/highlights/read'
import { highlightsFor } from '~/server/highlights/resolve'
import {
  bookSummaries,
  createHighlight,
  deleteForBook,
  deleteHighlight,
  getHighlight,
  listForBook,
  type NewHighlight,
  updateHighlight,
} from '~/server/highlights/store'
import { hashToken, newSessionToken } from '~/server/security'
import { createSession } from '~/server/sessions'
import { deleteBook, finishImport, startImport, storeChapter } from '~/server/user-books'
import type { ChapterBook } from '~/shared/content/schema'
import type { HighlightView } from '~/shared/highlights/group'
import { MAX_HIGHLIGHTS_PER_BOOK, MAX_HIGHLIGHTS_PER_USER } from '~/shared/highlights/limits'
import { bookPages } from '~/shared/highlights/page-text'
import { databaseUrl, freshDatabase } from '../testing/db'

const raw = postgres(databaseUrl, { max: 1, onnotice: () => {} })
const db = () => getDb()

beforeAll(freshDatabase)
afterAll(async () => {
  await raw.end()
  await closeDb()
})
beforeEach(async () => {
  await raw`truncate users, sessions, login_attempts, api_keys, audit_events, user_books, highlights restart identity cascade`
})

let users = 0
/** A plain member: no grant and no subscription, so the limits here are every account's. */
const newUser = () => testUser(db(), `reader-${++users}`, '$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA', 'member')

const PRIDE: BookRef = refFor('pride-and-prejudice')
const CODE_BOOK: BookRef = refFor('fixture-code-book')

const row = (over: Partial<NewHighlight> = {}): NewHighlight => ({
  chapter: 'chapter-6',
  page: 2,
  start: 10,
  end: 20,
  exact: 'a function',
  prefix: 'before ',
  suffix: ' after',
  color: 'yellow',
  note: null,
  ...over,
})

async function created(userId: number, book: BookRef, over: Partial<NewHighlight> = {}) {
  const result = await createHighlight(db(), userId, book, row(over))
  if (typeof result === 'string') throw new Error(result)
  return result.row
}

async function privateBook(userId: number): Promise<BookRef> {
  const start = await startImport(db(), userId, {
    title: 'Notes',
    author: 'Ada',
    language: 'en',
    details: NO_DETAILS,
    chapterCount: 1,
  })
  if (!start.ok) throw new Error('could not start')
  await storeChapter(db(), userId, start.id, 0, { title: 'Only', pages: ['<p>one</p>'] })
  expect(await finishImport(db(), userId, start.id, null)).toBe('ok')
  return privateRef(start.id)
}

describe('the highlights table', () => {
  it('belongs to exactly one book, and refuses out-of-range values', async () => {
    const user = await newUser()
    const insert = (slug: string | null, bookId: string | null, exact = 'x', start = 0, end = 1) =>
      raw`insert into highlights (user_id, book_slug, user_book_id, page, start_offset, end_offset, exact, color)
          values (${user.id}, ${slug}, ${bookId}, 1, ${start}, ${end}, ${exact}, 'yellow')`
    await expect(insert(null, null)).rejects.toThrow(/check/)
    const book = await privateBook(user.id)
    await expect(insert('pride-and-prejudice', book.userBookId)).rejects.toThrow(/check/)
    await expect(insert('pride-and-prejudice', null, '')).rejects.toThrow(/check/)
    await expect(insert('pride-and-prejudice', null, 'x', 5, 5)).rejects.toThrow(/check/)
    await insert('pride-and-prejudice', null)
    await insert(null, book.userBookId)
  })
})

describe('the store', () => {
  it('creates, lists, updates and deletes, scoped by user and book', async () => {
    const user = await newUser()
    const first = await created(user.id, PRIDE)
    expect(first).toMatchObject({ chapter: 'chapter-6', page: 2, start: 10, end: 20, exact: 'a function', note: null })
    await created(user.id, CODE_BOOK)
    expect((await listForBook(db(), user.id, PRIDE)).map((h) => h.id)).toEqual([first.id])

    const noted = await updateHighlight(db(), user.id, first.id, { note: 'Remember this.' })
    expect(noted).toMatchObject({ note: 'Remember this.', color: 'yellow', book: PRIDE })
    expect(noted && noted.updatedAt >= first.updatedAt).toBe(true)
    expect(await updateHighlight(db(), user.id, first.id, { color: 'green' })).toMatchObject({
      color: 'green',
      note: 'Remember this.',
    })
    expect(await updateHighlight(db(), user.id, first.id, { note: null })).toMatchObject({ color: 'green', note: null })
    expect(await updateHighlight(db(), user.id, first.id, {})).toBeNull()
    expect(await getHighlight(db(), user.id, first.id)).toMatchObject({ id: first.id, book: PRIDE })

    expect(await deleteHighlight(db(), user.id, first.id)).toBe(true)
    expect(await deleteHighlight(db(), user.id, first.id)).toBe(false)
    expect(await getHighlight(db(), user.id, first.id)).toBeNull()
    expect(await getHighlight(db(), user.id, 'not-a-uuid')).toBeNull()
  })

  it('never lets another user read, change or delete a highlight, or highlight their private book', async () => {
    const alice = await newUser()
    const bob = await newUser()
    const mine = await created(alice.id, PRIDE)
    expect(await listForBook(db(), bob.id, PRIDE)).toEqual([])
    expect(await getHighlight(db(), bob.id, mine.id)).toBeNull()
    expect(await updateHighlight(db(), bob.id, mine.id, { note: 'Bob was here' })).toBeNull()
    expect(await deleteHighlight(db(), bob.id, mine.id)).toBe(false)
    expect(await deleteForBook(db(), bob.id, PRIDE)).toBe(0)

    const book = await privateBook(alice.id)
    expect(await createHighlight(db(), bob.id, book, row())).toBe('missing')
    await created(alice.id, book)
    expect(await listForBook(db(), bob.id, book)).toEqual([])
    expect(await getHighlight(db(), alice.id, mine.id)).toMatchObject({ note: null })
  })

  it('refuses a highlight on a private book that is still uploading', async () => {
    const user = await newUser()
    const start = await startImport(db(), user.id, {
      title: 'N',
      author: 'A',
      language: 'en',
      details: NO_DETAILS,
      chapterCount: 1,
    })
    if (!start.ok) throw new Error('could not start')
    expect(await createHighlight(db(), user.id, privateRef(start.id), row())).toBe('missing')
  })

  it('deletes a private book’s highlights with the book, and every highlight with the user', async () => {
    const user = await newUser()
    const book = await privateBook(user.id)
    await created(user.id, book)
    await created(user.id, PRIDE)
    expect(await deleteBook(db(), user.id, book.userBookId as string)).toBe(true)
    expect(await raw`select 1 from highlights`).toHaveLength(1)
    await raw`delete from users where id = ${user.id}`
    expect(await raw`select 1 from highlights`).toHaveLength(0)
  })

  it('deletes every highlight in one book only', async () => {
    const user = await newUser()
    await created(user.id, PRIDE)
    await created(user.id, PRIDE)
    await created(user.id, CODE_BOOK)
    expect(await deleteForBook(db(), user.id, PRIDE)).toBe(2)
    expect(await listForBook(db(), user.id, CODE_BOOK)).toHaveLength(1)
  })

  it('summarises each book, most recently changed first', async () => {
    const user = await newUser()
    const book = await privateBook(user.id)
    await created(user.id, PRIDE, { note: 'one' })
    await created(user.id, PRIDE)
    await created(user.id, book)
    const later = await created(user.id, CODE_BOOK)
    await raw`update highlights set updated_at = now() + interval '1 minute' where id = ${later.id}`
    const summaries = await bookSummaries(db(), user.id)
    expect(summaries.map((s) => [s.book.slug ?? s.book.userBookId, s.highlights, s.notes])).toEqual([
      ['fixture-code-book', 1, 0],
      [book.userBookId, 1, 0],
      ['pride-and-prejudice', 2, 1],
    ])
    expect(await bookSummaries(db(), (await newUser()).id)).toEqual([])
  })
})

describe('a book’s highlights, resolved (highlightsFor)', () => {
  it('resolves them against the book, lists a removed catalogue book’s as missing, and finds nothing else', async () => {
    const [owner, other] = [await newUser(), await newUser()]
    await created(owner.id, PRIDE)
    const found = await highlightsFor(db(), owner.id, 'pride-and-prejudice')
    expect(found?.book).toEqual({
      slug: 'pride-and-prejudice',
      title: 'Pride and Prejudice',
      author: 'Jane Austen',
      removed: false,
    })
    expect(found?.highlights).toHaveLength(1)

    await created(owner.id, refFor('gone-book'))
    const gone = await highlightsFor(db(), owner.id, 'gone-book')
    expect(gone?.book).toEqual({
      slug: 'gone-book',
      title: 'A book no longer in the library',
      author: '',
      removed: true,
    })
    expect(gone?.highlights.map((h) => h.status)).toEqual(['missing'])
    expect(await highlightsFor(db(), other.id, 'gone-book')).toBeNull()

    const book = await privateBook(owner.id)
    await created(owner.id, book)
    expect((await highlightsFor(db(), owner.id, slugOf(book)))?.book.title).toBe('Notes')
    expect(await highlightsFor(db(), other.id, slugOf(book))).toBeNull()
  })
})

describe('the limits', () => {
  async function fill(userId: number, book: BookRef, n: number) {
    await raw`
      insert into highlights (user_id, book_slug, user_book_id, chapter, page, start_offset, end_offset, exact, color)
      select ${userId}, ${book.slug}, ${book.userBookId}, 'chapter-6', 1, 0, 1, 'x', 'yellow'
      from generate_series(1, ${n})`
  }

  it('allow 1,000 highlights per book, and two parallel creates can’t both take the last slot', async () => {
    const user = await newUser()
    await fill(user.id, PRIDE, MAX_HIGHLIGHTS_PER_BOOK - 1)
    const results = await Promise.all([
      createHighlight(db(), user.id, PRIDE, row()),
      createHighlight(db(), user.id, PRIDE, row()),
    ])
    expect(results.filter((r) => r === 'limit-book')).toHaveLength(1)
    expect(results.filter((r) => typeof r === 'object')).toHaveLength(1)
    expect(typeof (await createHighlight(db(), user.id, CODE_BOOK, row()))).toBe('object')
  })

  it('allow 10,000 highlights per user across books', async () => {
    const user = await newUser()
    for (let i = 0; i < MAX_HIGHLIGHTS_PER_USER / MAX_HIGHLIGHTS_PER_BOOK; i++) {
      await fill(user.id, { slug: `book-${i}`, userBookId: null }, MAX_HIGHLIGHTS_PER_BOOK - (i === 0 ? 1 : 0))
    }
    const results = await Promise.all([
      createHighlight(db(), user.id, PRIDE, row()),
      createHighlight(db(), user.id, PRIDE, row()),
    ])
    expect(results.filter((r) => r === 'limit-user')).toHaveLength(1)
    expect(results.filter((r) => typeof r === 'object')).toHaveLength(1)
  })

  it('answer the per-book cap when a book and the reader are both full', async () => {
    const user = await newUser()
    await fill(user.id, PRIDE, 2)
    expect(await createHighlight(db(), user.id, PRIDE, row(), { perBook: 2, perUser: 2 })).toBe('limit-book')
  })
})

describe('the endpoints', () => {
  const origin = getConfig().appOrigin
  const cookieName = getConfig().cookieSecure ? '__Host-session' : 'session'
  const pride = JSON.parse(readFileSync('tests/e2e/content/books/pride-and-prejudice.json', 'utf8')) as ChapterBook
  const pages = bookPages(pride)
  const chapter6Page2 = pages.find((p) => p.chapterSlug === 'chapter-6' && p.page === 2)
  if (!chapter6Page2) throw new Error('fixture page missing')
  const passage = chapter6Page2.text.slice(100, 160)

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
    start: 100,
    end: 160,
    text: passage,
    color: 'yellow',
    ...over,
  })

  const create = (cookie: string | null, over: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
    handleCreate(post('/account/highlights/new', cookie, createBody(over), headers))

  const change = (cookie: string | null, id: string, body: unknown) =>
    handleChange(post(`/account/highlights/${id}`, cookie, body), id)

  const answer = async (response: Response) => [
    response.status,
    response.status === 403 ? null : (((await response.json()) as { error?: string }).error ?? null),
  ]

  const exportAs = (cookie: string | null, slug: string) =>
    handleExport(
      new Request(`${origin}/account/highlights/export/${slug}`, { headers: cookie ? { cookie } : {} }),
      slug,
    )

  it('creates, changes and deletes a highlight, computing its context on the server', async () => {
    const { user, cookie } = await signedIn()
    const response = await create(cookie, { note: '  Mine. ' })
    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const { highlight } = (await response.json()) as { highlight: HighlightView }
    expect(highlight).toMatchObject({
      color: 'yellow',
      note: 'Mine.',
      text: passage,
      status: 'ok',
      place: { chapter: 'chapter-6', page: 2, label: 'Ch. 6 · p. 2', start: 100, end: 160 },
    })
    expect(highlight.place?.href).toBe(`/read/pride-and-prejudice/chapter-6/2#highlight-${highlight.id}`)
    expect(highlight).not.toHaveProperty('prefix')
    const [stored] = await raw<{ prefix: string; suffix: string }[]>`select prefix, suffix from highlights`
    expect(stored).toEqual({ prefix: chapter6Page2.text.slice(68, 100), suffix: chapter6Page2.text.slice(160, 192) })

    const recoloured = await change(cookie, highlight.id, { intent: 'update', color: 'pink', note: '' })
    expect(recoloured.status).toBe(200)
    expect(((await recoloured.json()) as { highlight: HighlightView }).highlight).toMatchObject({
      color: 'pink',
      note: null,
    })
    expect(await listForBook(db(), user.id, PRIDE)).toHaveLength(1)

    const deleted = await change(cookie, highlight.id, { intent: 'delete' })
    expect([deleted.status, await deleted.json()]).toEqual([200, { ok: true }])
    expect(await answer(await change(cookie, highlight.id, { intent: 'delete' }))).toEqual([404, 'not_found'])
  })

  it('maps every refusal to its status and code', async () => {
    const { cookie } = await signedIn()
    expect(await answer(await create(null))).toEqual([401, 'signed_out'])
    expect(await answer(await create(cookie, { book: 'no-such-book' }))).toEqual([404, 'not_found'])
    expect(await answer(await create(cookie, { prefix: 'trust me' }))).toEqual([400, 'invalid'])
    expect(await answer(await create(cookie, { position: { chapter: 'chapter-6', page: 99 } }))).toEqual([
      400,
      'invalid',
    ])
    expect(await answer(await create(cookie, { position: { printedPage: 2 } }))).toEqual([400, 'invalid'])
    expect(await answer(await create(cookie, { end: chapter6Page2.text.length + 1 }))).toEqual([400, 'invalid'])
    expect(await answer(await create(cookie, { text: `${passage.slice(1)}x` }))).toEqual([409, 'stale'])
    expect(await answer(await handleCreate(post('/account/highlights/new', cookie, 'not json')))).toEqual([
      400,
      'invalid',
    ])
    expect(await answer(await change(cookie, 'not-a-uuid', { intent: 'delete' }))).toEqual([404, 'not_found'])
    expect(await answer(await change(null, '6f1c0000-0000-4000-8000-000000000000', { intent: 'delete' }))).toEqual([
      401,
      'signed_out',
    ])
  })

  it('lets a plain member reach the per-user limit, answers the next with no plan, and lets them add one after deleting one', async () => {
    const { user, cookie } = await signedIn()
    await raw`
      insert into highlights (user_id, book_slug, chapter, page, start_offset, end_offset, exact, color)
      select ${user.id}, 'book-' || (n % 10), 'chapter-1', 1, 0, 1, 'x', 'yellow'
      from generate_series(1, ${MAX_HIGHLIGHTS_PER_USER}) as n`
    const refused = await create(cookie)
    expect([refused.status, await refused.json()]).toEqual([
      409,
      { error: 'quota', scope: 'user', max: MAX_HIGHLIGHTS_PER_USER },
    ])
    await raw`delete from highlights where id = (select id from highlights where user_id = ${user.id} limit 1)`
    expect((await create(cookie)).status).toBe(201)
  })

  it('lets a plain member reach the per-book limit, and answers the next with no plan', async () => {
    const { user, cookie } = await signedIn()
    await raw`
      insert into highlights (user_id, book_slug, chapter, page, start_offset, end_offset, exact, color)
      select ${user.id}, 'pride-and-prejudice', 'chapter-6', 1, 0, 1, 'x', 'yellow'
      from generate_series(1, ${MAX_HIGHLIGHTS_PER_BOOK})`
    const response = await create(cookie)
    expect([response.status, await response.json()]).toEqual([
      409,
      { error: 'quota', scope: 'book', max: MAX_HIGHLIGHTS_PER_BOOK },
    ])
  })

  it('reads the open book’s highlights: signed out, not found, ready, and unavailable when the database fails', async () => {
    const alice = await signedIn()
    const bob = await signedIn()
    const read = (cookie: string | null, book: string) =>
      bookHighlightsState(new Request(`${origin}/`, { headers: cookie ? { cookie } : {} }), book)
    expect(await read(null, 'pride-and-prejudice')).toEqual({ state: 'signed_out' })
    expect(await read(alice.cookie, 'no-such-book')).toEqual({ state: 'not_found' })
    const mine = await privateBook(alice.user.id)
    expect(await read(bob.cookie, slugOf(mine))).toEqual({ state: 'not_found' })
    expect(await read(alice.cookie, 'pride-and-prejudice')).toEqual({ state: 'ready', highlights: [] })
    const { highlight } = (await (await create(alice.cookie)).json()) as { highlight: HighlightView }
    expect(await read(alice.cookie, 'pride-and-prejudice')).toEqual({ state: 'ready', highlights: [highlight] })

    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = (() => {
      throw new Error('the database went away')
    }) as unknown as Pool
    try {
      vi.mocked(getDb).mockReturnValueOnce(getDb()).mockReturnValueOnce(broken)
      expect(await read(alice.cookie, 'pride-and-prejudice')).toEqual({ state: 'unavailable' })
      expect(String(errors.mock.calls[0]?.[0])).toMatch(/^\[book highlights\] /)
    } finally {
      errors.mockRestore()
    }
  })

  it('answers 404 to another user, for highlights and private books alike, from every route', async () => {
    const alice = await signedIn()
    const bob = await signedIn()
    const { highlight } = (await (await create(alice.cookie)).json()) as { highlight: HighlightView }
    expect(await answer(await change(bob.cookie, highlight.id, { intent: 'update', note: 'Bob' }))).toEqual([
      404,
      'not_found',
    ])
    expect(await answer(await change(bob.cookie, highlight.id, { intent: 'delete' }))).toEqual([404, 'not_found'])

    const book = await privateBook(alice.user.id)
    const slug = slugOf(book)
    const privateBody = { book: slug, position: { chapter: 'only', page: 1 }, start: 0, end: 3, text: 'one' }
    expect((await create(alice.cookie, privateBody)).status).toBe(201)
    expect(await answer(await create(bob.cookie, privateBody))).toEqual([404, 'not_found'])
    expect((await exportAs(bob.cookie, slug)).status).toBe(404)
    const own = await exportAs(alice.cookie, slug)
    expect(own.status).toBe(200)
    expect(own.headers.get('content-disposition')).toBe('attachment; filename="notes-highlights.md"')
  })

  const highlightsPage = (cookie: string | null, book?: string) =>
    highlightsPageState(
      new Request(`${origin}/account/highlights${book ? `?book=${book}` : ''}`, { headers: cookie ? { cookie } : {} }),
      book,
    )

  it('answers /account/highlights?book= with the owner’s private book only; anyone else gets a 404', async () => {
    const alice = await signedIn()
    const bob = await signedIn()
    const book = await privateBook(alice.user.id)
    const slug = slugOf(book)
    const privateBody = { book: slug, position: { chapter: 'only', page: 1 }, start: 0, end: 3, text: 'one' }
    expect((await create(alice.cookie, privateBody)).status).toBe(201)

    const own = await highlightsPage(alice.cookie, slug)
    expect(own.kind === 'book' && [own.book, own.highlights.map((h) => h.text)]).toEqual([
      { slug, title: 'Notes', author: 'Ada', removed: false },
      ['one'],
    ])
    expect(await highlightsPage(bob.cookie, slug)).toEqual({ kind: 'not_found' })
    expect(await highlightsPage(bob.cookie, 'no-such-book')).toEqual({ kind: 'not_found' })
    expect(await highlightsPage(null, slug)).toEqual({ kind: 'signed_out' })

    expect((await create(alice.cookie)).status).toBe(201)
    const list = await highlightsPage(alice.cookie)
    expect(list.kind === 'all' && list.books.map((b) => [b.slug, b.title, b.removed, b.highlights])).toEqual([
      ['pride-and-prejudice', 'Pride and Prejudice', false, 1],
      [slug, 'Notes', false, 1],
    ])
    expect(await highlightsPage(bob.cookie)).toEqual({ kind: 'all', books: [] })
  })

  it('exports Markdown as an attachment for a plain member, and sends a signed-out visitor to sign in', async () => {
    const { cookie } = await signedIn()
    await create(cookie, { note: 'A note.' })
    const response = await exportAs(cookie, 'pride-and-prejudice')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="pride-and-prejudice-highlights.md"')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const markdown = await response.text()
    const today = new Date().toISOString().slice(0, 10)
    expect(markdown).toMatch(
      new RegExp(
        `^---\\ntitle: "Pride and Prejudice"\\nauthor: "Jane Austen"\\nsource: "${origin}/account/highlights\\?book=pride-and-prejudice"\\nexported: ${today}\\nhighlights: 1\\nnotes: 1\\ntags:\\n  - "folio"\\n  - "highlights"\\n---\\n\\n`,
      ),
    )
    expect(markdown).toContain('\n# Pride and Prejudice\n\nJane Austen · 1 highlight · exported from Folio on ')
    expect(markdown).toContain('## 6. Chapter 6')
    expect(markdown).toContain('A note.')
    expect(markdown).toContain(`(${origin}/read/pride-and-prejudice/chapter-6/2#highlight-`)

    const out = await exportAs(null, 'pride-and-prejudice')
    expect(out.status).toBe(302)
    expect(out.headers.get('location')).toBe(
      `/login?next=${encodeURIComponent('/account/highlights?book=pride-and-prejudice')}`,
    )
    expect((await exportAs(cookie, 'no-such-book')).status).toBe(404)
    expect((await exportAs(cookie, '..%2Fetc')).status).toBe(404)
  })

  const exportAll = (cookie: string | null) =>
    handleExportAll(new Request(`${origin}/account/highlights/export`, { headers: cookie ? { cookie } : {} }))

  it('exports every book in one file, in title order, removed books last, and only the reader’s own', async () => {
    const { user, cookie } = await signedIn()
    await create(cookie, { note: 'Mine.' })
    await created(user.id, CODE_BOOK, { exact: 'Code that moved away.' })
    const book = await privateBook(user.id)
    await created(user.id, book, { chapter: 'only', page: 1, start: 0, end: 3, exact: 'one' })
    await created(user.id, refFor('gone-book'), { exact: 'From a book that left.' })
    const other = await signedIn()
    await created(other.user.id, PRIDE, { exact: 'Not yours.' })
    const theirs = await privateBook(other.user.id)
    await raw`update user_books set title = 'Their Secret Book' where id = ${theirs.userBookId}`
    await created(other.user.id, theirs, { exact: 'Also not yours.' })

    const response = await exportAll(cookie)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="folio-highlights-${new Date().toISOString().slice(0, 10)}.md"`,
    )
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const markdown = await response.text()
    expect(markdown).toMatch(/^---\ntitle: "Folio highlights"\n/)
    expect(markdown).toContain('\nbooks: 4\nhighlights: 4\nnotes: 1\n')
    expect(markdown.match(/^## .*$/gm)).toEqual([
      '## A Small Book of Code',
      '## Notes',
      '## Pride and Prejudice',
      '## A book no longer in the library',
    ])
    expect(markdown).toContain('`gone-book` · 1 highlight · 0 notes')
    expect(markdown).toContain(`[Open in Folio](${origin}/account/highlights?book=pride-and-prejudice)`)
    expect(markdown).toContain('### 6. Chapter 6')
    expect(markdown).not.toContain('Not yours.')
    expect(markdown).not.toContain('Their Secret Book')
    expect(markdown).not.toContain('Also not yours.')
  })

  it('answers 500 when the database fails during either export, and logs it', async () => {
    const { cookie } = await signedIn()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = (() => {
      throw new Error('the database went away')
    }) as unknown as Pool
    try {
      vi.mocked(getDb).mockReturnValueOnce(getDb()).mockReturnValueOnce(broken)
      const response = await exportAll(cookie)
      expect([response.status, await response.text()]).toEqual([
        500,
        'Something went wrong. Try again in a few minutes.',
      ])
      vi.mocked(getDb).mockReturnValueOnce(getDb()).mockReturnValueOnce(broken)
      expect((await exportAs(cookie, 'pride-and-prejudice')).status).toBe(500)
      expect(errors.mock.calls.map((call) => String(call[0]))).toEqual([
        expect.stringMatching(/^\[highlights export all\] /),
        expect.stringMatching(/^\[highlights export\] /),
      ])
    } finally {
      errors.mockRestore()
    }
  })

  it('exports "No highlights yet." for a reader with none, and sends a signed-out visitor to sign in', async () => {
    const { cookie } = await signedIn()
    const markdown = await (await exportAll(cookie)).text()
    expect(markdown).toContain('\nbooks: 0\n')
    expect(markdown.match(/No highlights yet\./g)).toHaveLength(1)

    const out = await exportAll(null)
    expect(out.status).toBe(302)
    expect(out.headers.get('location')).toBe(`/login?next=${encodeURIComponent('/account/highlights')}`)
  })

  it('finds a highlight again after its page text moved, and lists one it cannot find as missing', async () => {
    const { user, cookie } = await signedIn()
    await create(cookie)
    await raw`update highlights set start_offset = 0, end_offset = 60, page = 1`
    await createHighlight(db(), user.id, PRIDE, row({ exact: 'Text that is in no book at all.', start: 0, end: 31 }))
    const markdown = await (await exportAs(cookie, 'pride-and-prejudice')).text()
    expect(markdown).toContain('/read/pride-and-prejudice/chapter-6/2#highlight-')
    expect(markdown).toContain('## Passages no longer found\n\n> Text that is in no book at all.')
  })

  it('deletes one highlight, or a whole book of them, from the account page form', async () => {
    const { user, cookie } = await signedIn()
    const { highlight } = (await (await create(cookie)).json()) as { highlight: HighlightView }
    await create(cookie)
    const form = (fields: Record<string, string>, who = cookie) =>
      handleHighlightsForm(
        new Request(`${origin}/account/highlights`, {
          method: 'POST',
          headers: { origin, cookie: who, 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams(fields),
        }),
      )
    const other = await signedIn()
    expect((await form({ intent: 'delete', id: highlight.id }, other.cookie)).headers.get('location')).toBe(
      '/account/highlights?error=missing',
    )
    expect((await form({ intent: 'delete', id: highlight.id })).headers.get('location')).toBe(
      '/account/highlights?book=pride-and-prejudice&status=deleted',
    )
    expect(await listForBook(db(), user.id, PRIDE)).toHaveLength(1)
    expect((await form({ intent: 'delete-book', book: 'pride-and-prejudice' })).headers.get('location')).toBe(
      '/account/highlights?status=deleted-book',
    )
    expect(await listForBook(db(), user.id, PRIDE)).toHaveLength(0)
    expect((await form({ intent: 'nope' })).headers.get('location')).toBe('/account/highlights?error=invalid')
  })
})
