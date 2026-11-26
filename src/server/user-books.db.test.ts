import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../shared/import/blocks.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared/import/blocks.ts')>()
  return { ...actual, checkChapterUpload: vi.fn(actual.checkChapterUpload) }
})

import { recordEvent } from '~/server/audit'
import { handleBooksForm, handleChapter, handleFinish, handleNewBook } from '~/server/book-actions'
import { getConfig } from '~/server/config'
import { closeDb, getDb } from '~/server/db'
import { hashToken, newSessionToken } from '~/server/security'
import { createSession } from '~/server/sessions'
import {
  countedBooks,
  deleteBook,
  finishImport,
  listBooks,
  loadBookText,
  loadReaderBook,
  startImport,
  storeChapter,
  sweepStaleUploads,
} from '~/server/user-books'
import { checkChapterUpload } from '~/shared/import/blocks'
import { MAX_BOOK_HTML_BYTES, MAX_BOOKS } from '~/shared/import/limits'
import { NO_DETAILS } from '../shared/import/details.ts'
import { databaseUrl, freshDatabase } from './testing/db'
import { testUser } from './testing/users'

const raw = postgres(databaseUrl, { max: 1, onnotice: () => {} })
const db = () => getDb()
const META = { title: 'My Notes', author: 'Ada', language: 'en', details: NO_DETAILS, chapterCount: 2 }
const BODY = { title: 'My Notes', author: 'Ada', language: 'en', chapterCount: 2 }

beforeAll(freshDatabase)
afterAll(async () => {
  await raw.end()
  await closeDb()
})
beforeEach(async () => {
  await raw`truncate users, sessions, login_attempts, api_keys, audit_events, user_books restart identity cascade`
})

/** A plain member: no grant and no subscription, so the limits here are every account's. */
const newUser = (username: string) => testUser(db(), username, '$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA', 'member')

const formerStarterCopy = (userId: number) => raw`
  insert into user_books (user_id, title, author, language, status, chapter_count, ready_at, starter)
  values (${userId}, 'Pride and Prejudice', 'Jane Austen', 'en-GB', 'ready', 1, now(), true)`

async function userWithBook(username: string) {
  const user = await newUser(username)
  const start = await startImport(db(), user.id, META)
  if (!start.ok) throw new Error('could not start')
  await storeChapter(db(), user.id, start.id, 0, { title: 'Getting Started', pages: ['<p>one</p>', '<p>two</p>'] })
  await storeChapter(db(), user.id, start.id, 1, { title: 'Getting started', pages: ['<p>three</p>'] })
  expect(await finishImport(db(), user.id, start.id, null)).toBe('ok')
  return { user, bookId: start.id }
}

describe('importing', () => {
  it('gives a new account no book: its first listings are empty, and it is never marked as given the starter book', async () => {
    const user = await newUser('new')
    for (let i = 0; i < 2; i++) {
      expect(await listBooks(db(), user.id)).toEqual([])
      expect(await countedBooks(db(), user.id)).toBe(0)
    }
    const [row] = await raw<{ at: Date | null }[]>`select starter_book_at as at from users where id = ${user.id}`
    expect(row).toEqual({ at: null })
  })

  it('stores chapters with unique slugs, then lists the book once it is ready', async () => {
    const user = await newUser('reader')
    const start = await startImport(db(), user.id, META)
    if (!start.ok) throw new Error('could not start')
    await storeChapter(db(), user.id, start.id, 0, { title: 'Intro', pages: ['<p>a</p>'] })
    expect(await listBooks(db(), user.id)).toEqual([])
    expect(await loadReaderBook(db(), user.id, start.id, 'intro', 0)).toBeNull()
    expect(await finishImport(db(), user.id, start.id, null)).toBe('incomplete')

    await storeChapter(db(), user.id, start.id, 1, { title: 'Intro', pages: ['<p>b</p>', '<p>c</p>'] })
    expect(await finishImport(db(), user.id, start.id, '203.0.113.5')).toBe('ok')
    expect(await finishImport(db(), user.id, start.id, null)).toBe('missing')

    const [book] = await listBooks(db(), user.id)
    expect(book).toMatchObject({ id: start.id, title: 'My Notes', chapterCount: 2, firstChapter: 'intro' })
    expect(book?.htmlBytes).toBe('<p>a</p><p>b</p><p>c</p>'.length)
    const reader = await loadReaderBook(db(), user.id, start.id, 'intro-2', 1)
    expect(reader?.chapters).toEqual([
      { slug: 'intro', title: 'Intro', pageCount: 1 },
      { slug: 'intro-2', title: 'Intro', pageCount: 2 },
    ])
    expect(reader?.html).toBe('<p>c</p>')
    expect((await loadReaderBook(db(), user.id, start.id, 'intro', 5))?.html).toBeNull()

    const [event] = await raw<{ event: string; detail: object }[]>`select event, detail from audit_events`
    expect(event).toEqual({ event: 'book.imported', detail: { bookId: start.id, chapters: 2, htmlBytes: 24 } })
  })

  it('replaces a chapter sent again and refuses positions past the count', async () => {
    const user = await newUser('reader')
    const start = await startImport(db(), user.id, { ...META, chapterCount: 1 })
    if (!start.ok) throw new Error('could not start')
    await storeChapter(db(), user.id, start.id, 0, { title: 'Old', pages: ['<p>old old old</p>'] })
    await storeChapter(db(), user.id, start.id, 0, { title: 'New', pages: ['<p>new</p>'] })
    expect(await storeChapter(db(), user.id, start.id, 1, { title: 'Extra', pages: ['<p>x</p>'] })).toBe('position')
    const [row] = await raw`select html_bytes from user_books`
    expect(Number(row?.html_bytes)).toBe('<p>new</p>'.length)
    expect(await raw`select slug, title from user_book_chapters`).toEqual([{ slug: 'new', title: 'New' }])
  })

  it('counts rendered HTML against the 8 MB book limit', async () => {
    const user = await newUser('reader')
    const start = await startImport(db(), user.id, { ...META, chapterCount: 3 })
    if (!start.ok) throw new Error('could not start')
    const half = 'x'.repeat(MAX_BOOK_HTML_BYTES / 2)
    expect(await storeChapter(db(), user.id, start.id, 0, { title: 'A', pages: [half] })).toBe('ok')
    expect(await storeChapter(db(), user.id, start.id, 1, { title: 'B', pages: [half] })).toBe('ok')
    expect(await storeChapter(db(), user.id, start.id, 2, { title: 'C', pages: ['x'] })).toBe('too-big')
    expect(await storeChapter(db(), user.id, start.id, 1, { title: 'B', pages: ['small'] })).toBe('ok')
    expect(await storeChapter(db(), user.id, start.id, 2, { title: 'C', pages: ['x'] })).toBe('ok')
  })

  it('allows 25 books per user, counting unfinished ones', async () => {
    const user = await newUser('reader')
    const other = await newUser('other')
    for (let i = 0; i < MAX_BOOKS; i++) expect((await startImport(db(), user.id, META)).ok).toBe(true)
    expect(await startImport(db(), user.id, META)).toEqual({ ok: false, reason: 'quota', max: MAX_BOOKS })
    expect((await startImport(db(), other.id, META)).ok).toBe(true)
  })

  it('counts a former starter copy toward the limit like any book', async () => {
    const user = await newUser('reader')
    await formerStarterCopy(user.id)
    expect(await countedBooks(db(), user.id)).toBe(1)
    for (let i = 1; i < MAX_BOOKS; i++) expect((await startImport(db(), user.id, META)).ok).toBe(true)
    expect(await startImport(db(), user.id, META)).toEqual({ ok: false, reason: 'quota', max: MAX_BOOKS })
  })

  it('allows 10 finished imports an hour', async () => {
    const user = await newUser('reader')
    for (let i = 0; i < 10; i++) await recordEvent(db(), 'book.imported', { userId: user.id })
    expect(await startImport(db(), user.id, META)).toEqual({ ok: false, reason: 'rate' })
    await raw`update audit_events set at = now() - interval '61 minutes'`
    expect((await startImport(db(), user.id, META)).ok).toBe(true)
  })

  it('sweeps uploads still unfinished after 24 hours on the next import, and only that user’s', async () => {
    const user = await newUser('reader')
    const other = await newUser('other')
    const stale = await startImport(db(), user.id, META)
    const fresh = await startImport(db(), user.id, META)
    const othersStale = await startImport(db(), other.id, META)
    if (!stale.ok || !fresh.ok || !othersStale.ok) throw new Error('could not start')
    await raw`update user_books set created_at = now() - interval '25 hours' where id in ${raw([stale.id, othersStale.id])}`
    const { bookId: ready } = await userWithBook('third')
    await raw`update user_books set created_at = now() - interval '30 days' where id = ${ready}`

    await startImport(db(), user.id, META)
    const ids = (await raw<{ id: string }[]>`select id from user_books`).map((r) => r.id)
    expect(ids).not.toContain(stale.id)
    expect(ids).toContain(fresh.id)
    expect(ids).toContain(othersStale.id)
    expect(ids).toContain(ready)
    expect(await sweepStaleUploads(db(), other.id)).toBe(1)
  })
})

describe('owner isolation', () => {
  it('never shows, reads, changes or deletes another user’s book', async () => {
    const { user: alice, bookId } = await userWithBook('alice')
    const bob = await newUser('bob')
    expect(await listBooks(db(), bob.id)).toEqual([])
    expect(await loadReaderBook(db(), bob.id, bookId, 'getting-started', 0)).toBeNull()
    expect(await loadBookText(db(), bob.id, bookId)).toBeNull()
    expect(await deleteBook(db(), bob.id, bookId)).toBe(false)

    const upload = await startImport(db(), alice.id, META)
    if (!upload.ok) throw new Error('could not start')
    expect(await storeChapter(db(), bob.id, upload.id, 0, { title: 'Bob was here', pages: ['<p>x</p>'] })).toBe(
      'missing',
    )
    expect(await finishImport(db(), bob.id, upload.id, null)).toBe('missing')
    expect(await raw`select 1 from user_book_chapters where title = 'Bob was here'`).toHaveLength(0)

    expect(await loadBookText(db(), alice.id, bookId)).toHaveLength(2)
  })
})

describe('deleting', () => {
  it('removes the book and its chapters at once, and the user’s books with the user', async () => {
    const { user, bookId } = await userWithBook('reader')
    expect(await deleteBook(db(), user.id, bookId)).toBe(true)
    expect(await raw`select 1 from user_book_chapters`).toHaveLength(0)

    const second = await userWithBook('second')
    await raw`delete from users where id = ${second.user.id}`
    expect(await raw`select 1 from user_books`).toHaveLength(0)
    expect(await raw`select 1 from user_book_chapters`).toHaveLength(0)
  })
})

describe('the upload endpoints', () => {
  const origin = getConfig().appOrigin
  const cookieName = getConfig().cookieSecure ? '__Host-session' : 'session'

  async function signedIn(username: string) {
    const user = await newUser(username)
    const token = newSessionToken()
    await createSession(db(), { tokenHash: hashToken(token), userId: user.id, ip: null, userAgent: 'test' })
    return { user, cookie: `${cookieName}=${token}` }
  }

  const post = (cookie: string | null, body: unknown, headers: Record<string, string> = {}) =>
    new Request(`${origin}/account/books/x`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })

  const chapter = { title: 'Only', blocks: [{ type: 'paragraph', runs: [{ text: '<b>escaped</b>' }] }] }

  it('runs an import end to end and renders the blocks on the server', async () => {
    const { cookie } = await signedIn('reader')
    const start = await handleNewBook(post(cookie, { ...BODY, chapterCount: 1 }))
    expect(start.status).toBe(201)
    expect(start.headers.get('cache-control')).toBe('private, no-store')
    const { id } = (await start.json()) as { id: string }
    expect((await handleChapter(post(cookie, chapter), id, '0')).status).toBe(200)
    expect((await handleFinish(post(cookie, {}), id)).status).toBe(200)
    const [page] = await raw<{ pages: string[] }[]>`select pages from user_book_chapters`
    expect(page?.pages).toEqual(['<p>&lt;b&gt;escaped&lt;/b&gt;</p>'])
  })

  it('stores a listing’s Run code language as the pre’s data-lang, and refuses any other', async () => {
    const { cookie } = await signedIn('reader')
    const { id } = (await (await handleNewBook(post(cookie, { ...BODY, chapterCount: 1 }))).json()) as { id: string }
    const listing = (lang?: unknown) => ({
      title: 'Code',
      blocks: [lang === undefined ? { type: 'code', text: 'let a = 1' } : { type: 'code', text: 'let a = 1', lang }],
    })
    for (const lang of ['ruby', '"><script>']) {
      const refused = await handleChapter(post(cookie, listing(lang)), id, '0')
      expect([refused.status, ((await refused.json()) as { error: string }).error]).toEqual([400, 'invalid'])
    }
    expect((await handleChapter(post(cookie, listing('javascript')), id, '0')).status).toBe(200)
    const pages = async () => (await raw<{ pages: string[] }[]>`select pages from user_book_chapters`)[0]?.pages
    expect(await pages()).toEqual(['<pre data-lang="javascript">let a = 1</pre>'])
    expect((await handleChapter(post(cookie, listing()), id, '0')).status).toBe(200)
    expect(await pages()).toEqual(['<pre>let a = 1</pre>'])
  })

  it('refuses HTML, unknown fields and a chapter over its cap (413 request-too-large)', async () => {
    const { cookie } = await signedIn('reader')
    const { id } = (await (await handleNewBook(post(cookie, BODY))).json()) as { id: string }
    const status = async (request: Request) => {
      const response = await handleChapter(request, id, '0')
      return [response.status, ((await response.json()) as { error?: string }).error]
    }
    expect(await status(post(cookie, { title: 'x', html: '<script>' }))).toEqual([400, 'invalid'])
    expect(await status(post(cookie, { title: 'x', blocks: [{ type: 'html', html: '<p>' }] }))).toEqual([
      400,
      'invalid',
    ])
    expect(await status(post(cookie, { title: 'x', blocks: [] }))).toEqual([400, 'empty'])
    expect(await status(post(cookie, 'not json'))).toEqual([400, 'invalid'])
    const huge = { title: 'x', blocks: [{ type: 'code', text: 'x'.repeat(950_000) }] }
    expect(await status(post(cookie, huge))).toEqual([413, 'request-too-large'])
  })

  it('answers 500 failed, logged, when the chapter check fails other than by refusing', async () => {
    const { cookie } = await signedIn('reader')
    const { id } = (await (await handleNewBook(post(cookie, BODY))).json()) as { id: string }
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(checkChapterUpload).mockImplementationOnce(() => {
      throw new Error('the check broke')
    })
    try {
      const response = await handleChapter(post(cookie, chapter), id, '0')
      expect([response.status, await response.json()]).toEqual([500, { error: 'failed' }])
      expect(String(errors.mock.calls[0]?.[0])).toMatch(/^\[book import chapter\] Error: the check broke/)
    } finally {
      errors.mockRestore()
    }
  })

  it('answers 404 to another user, to no session and to unknown ids, and lets only the owner delete', async () => {
    const alice = await signedIn('alice')
    const bob = await signedIn('bob')
    const { id } = (await (await handleNewBook(post(alice.cookie, BODY))).json()) as { id: string }
    expect((await handleChapter(post(bob.cookie, chapter), id, '0')).status).toBe(404)
    expect((await handleChapter(post(null, chapter), id, '0')).status).toBe(404)
    expect((await handleChapter(post(alice.cookie, chapter), 'not-a-uuid', '0')).status).toBe(404)
    expect((await handleFinish(post(bob.cookie, {}), id)).status).toBe(404)
    expect((await handleNewBook(post(null, BODY))).status).toBe(401)

    const form = (cookie: string) =>
      new Request(`${origin}/account/books`, {
        method: 'POST',
        headers: { origin, cookie, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ intent: 'delete', id }),
      })
    expect((await handleBooksForm(form(bob.cookie))).headers.get('location')).toBe('/account/books?error=missing')
    const keep = new Request(`${origin}/account/books`, {
      method: 'POST',
      headers: { origin, cookie: alice.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ intent: 'keep', id }),
    })
    expect((await handleBooksForm(keep)).headers.get('location')).toBe('/account/books?error=invalid')
    expect((await handleBooksForm(form(alice.cookie))).headers.get('location')).toBe('/account/books?status=deleted')
    expect(await raw`select 1 from user_books`).toHaveLength(0)
    expect(
      await raw`select 1 from audit_events where user_id = ${alice.user.id} and event = 'book.deleted'`,
    ).toHaveLength(1)
  })

  it('lets a plain member import 25 books, and answers the 26th with the limit and no plan', async () => {
    const { cookie } = await signedIn('member')
    for (let i = 0; i < MAX_BOOKS; i++) expect((await handleNewBook(post(cookie, BODY))).status).toBe(201)
    const next = await handleNewBook(post(cookie, BODY))
    expect([next.status, await next.json()]).toEqual([409, { error: 'quota', scope: 'books', max: 25 }])
  })

  it('lets a reader at the limit import again once they delete a book, and keep and read the rest', async () => {
    const { user, cookie } = await signedIn('full')
    const ids: string[] = []
    for (let i = 0; i < MAX_BOOKS; i++) {
      const start = await startImport(db(), user.id, { ...META, chapterCount: 1 })
      if (!start.ok) throw new Error('could not start')
      if (i < 2) {
        await storeChapter(db(), user.id, start.id, 0, { title: 'Only', pages: ['<p>one</p>'] })
        await finishImport(db(), user.id, start.id, null)
      }
      ids.push(start.id)
    }
    expect((await handleNewBook(post(cookie, BODY))).status).toBe(409)
    expect(await loadReaderBook(db(), user.id, ids[1] ?? '', 'only', 0)).not.toBeNull()
    expect(await deleteBook(db(), user.id, ids[0] ?? '')).toBe(true)
    expect((await handleNewBook(post(cookie, BODY))).status).toBe(201)
    expect(await countedBooks(db(), user.id)).toBe(MAX_BOOKS)
  })

  it('counts a former starter copy, so 24 imports beside it are 25, and refuses only the next', async () => {
    const { user, cookie } = await signedIn('kept')
    await formerStarterCopy(user.id)
    await raw`
      insert into user_books (user_id, title, author, language, status, chapter_count, ready_at)
      select ${user.id}, 'Mine', 'Ada', 'en', 'ready', 1, now() from generate_series(1, ${MAX_BOOKS - 2})`
    expect(await countedBooks(db(), user.id)).toBe(MAX_BOOKS - 1)
    expect((await handleNewBook(post(cookie, BODY))).status).toBe(201)
    expect(await countedBooks(db(), user.id)).toBe(MAX_BOOKS)
    const next = await handleNewBook(post(cookie, BODY))
    expect([next.status, await next.json()]).toEqual([409, { error: 'quota', scope: 'books', max: MAX_BOOKS }])
    expect((await listBooks(db(), user.id)).filter((b) => b.title === 'Pride and Prejudice')).toHaveLength(1)
  })

  it('says quota and rate for the limits', async () => {
    const { user, cookie } = await signedIn('reader')
    for (let i = 0; i < 10; i++) await recordEvent(db(), 'book.imported', { userId: user.id })
    const rate = await handleNewBook(post(cookie, BODY))
    expect([rate.status, await rate.json()]).toEqual([429, { error: 'rate' }])
    await raw`delete from audit_events`
    for (let i = 0; i < MAX_BOOKS; i++) await startImport(db(), user.id, META)
    const quota = await handleNewBook(post(cookie, BODY))
    expect([quota.status, await quota.json()]).toEqual([409, { error: 'quota', scope: 'books', max: MAX_BOOKS }])
  })
})
