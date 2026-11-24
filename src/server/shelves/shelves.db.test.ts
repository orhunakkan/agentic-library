import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getConfig } from '~/server/config'
import { closeDb, getDb, type Pool } from '~/server/db'
import { NO_DETAILS } from '../../shared/import/details.ts'
import { testUser } from '../testing/users'

vi.mock('~/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/server/db')>()
  return { ...actual, getDb: vi.fn(actual.getDb) }
})

import { type BookRef, slugOf } from '~/server/books/ref'
import { hashToken, newSessionToken } from '~/server/security'
import { createSession } from '~/server/sessions'
import { handleShelfBook, handleShelfChange, handleShelfCreate, shelvesState } from '~/server/shelves/actions'
import {
  createShelf,
  deleteShelf,
  listShelves,
  renameShelf,
  type ShelfName,
  type ShelfRow,
  setShelfBook,
} from '~/server/shelves/store'
import { toShelfViews } from '~/server/shelves/view'
import { deleteBook, finishImport, startImport, storeChapter } from '~/server/user-books'
import type { ShelfView } from '~/shared/shelves/contract'
import { MAX_SHELF_BOOKS_PER_USER, MAX_SHELVES_PER_USER, shelfNameKey } from '~/shared/shelves/shelves'
import { databaseUrl, freshDatabase } from '../testing/db'

const raw = postgres(databaseUrl, { max: 1, onnotice: () => {} })
const db = () => getDb()

beforeAll(freshDatabase)
afterAll(async () => {
  await raw.end()
  await closeDb()
})
beforeEach(async () => {
  await raw`truncate users, sessions, login_attempts, api_keys, audit_events, user_books, shelves, shelf_books restart identity cascade`
})

let users = 0
const newUser = () => testUser(db(), `reader-${++users}`, '$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA', 'member')

const PRIDE: BookRef = { slug: 'pride-and-prejudice', userBookId: null }
const CODE_BOOK: BookRef = { slug: 'fixture-code-book', userBookId: null }
const NOWHERE = '6f1c0000-0000-4000-8000-000000000000'

const named = (name: string): ShelfName => ({ name, key: shelfNameKey(name) })

async function shelf(userId: number, name: string, book: BookRef | null = null): Promise<ShelfRow> {
  const result = await createShelf(db(), userId, named(name), book)
  if (typeof result === 'string') throw new Error(result)
  return result
}

async function privateBook(userId: number, finish = true): Promise<BookRef & { userBookId: string }> {
  const start = await startImport(db(), userId, {
    title: 'Notes',
    author: 'Ada',
    language: 'en',
    details: NO_DETAILS,
    chapterCount: 1,
  })
  if (!start.ok) throw new Error('could not start')
  if (finish) {
    await storeChapter(db(), userId, start.id, 0, { title: 'Only', pages: ['<p>one</p>'] })
    expect(await finishImport(db(), userId, start.id, null)).toBe('ok')
  }
  return { slug: null, userBookId: start.id }
}

async function fillBooks(userId: number, n: number) {
  const filler = await shelf(userId, `Filler ${n}`)
  await raw`
    insert into shelf_books (shelf_id, user_id, book_slug)
    select ${filler.id}, ${userId}, 'book-' || g from generate_series(1, ${n}) g`
}

describe('the shelves tables', () => {
  it('limit the name, and tie a row to its shelf’s user and to exactly one book', async () => {
    const alice = await newUser()
    const bob = await newUser()
    await expect(
      raw`insert into shelves (user_id, name, name_key) values (${alice.id}, ${'x'.repeat(41)}, 'x')`,
    ).rejects.toThrow(/check/)
    await expect(raw`insert into shelves (user_id, name, name_key) values (${alice.id}, '', 'x')`).rejects.toThrow(
      /check/,
    )
    const mine = await shelf(alice.id, 'To read')
    await expect(
      raw`insert into shelf_books (shelf_id, user_id, book_slug) values (${mine.id}, ${bob.id}, 'pride-and-prejudice')`,
    ).rejects.toThrow(/foreign key/)
    await expect(raw`insert into shelf_books (shelf_id, user_id) values (${mine.id}, ${alice.id})`).rejects.toThrow(
      /check/,
    )
    const book = await privateBook(alice.id)
    await expect(
      raw`insert into shelf_books (shelf_id, user_id, book_slug, user_book_id)
          values (${mine.id}, ${alice.id}, 'pride-and-prejudice', ${book.userBookId})`,
    ).rejects.toThrow(/check/)
  })
})

describe('the store', () => {
  it('makes a shelf with a book on it, and lists only the user’s own', async () => {
    const alice = await newUser()
    const bob = await newUser()
    const made = await shelf(alice.id, 'To read', PRIDE)
    expect(made).toEqual({ id: expect.any(String), name: 'To read', books: [PRIDE] })
    await shelf(alice.id, 'Empty')
    await shelf(bob.id, 'Bob’s')
    const listed = await listShelves(db(), alice.id)
    expect(listed.map((s) => s.name).sort()).toEqual(['Empty', 'To read'])
    expect(listed.find((s) => s.name === 'Empty')?.books).toEqual([])
    expect((await listShelves(db(), bob.id)).map((s) => s.name)).toEqual(['Bob’s'])
  })

  it('lists a shelf’s books newest added first', async () => {
    const user = await newUser()
    const s = await shelf(user.id, 'Mixed', PRIDE)
    const book = await privateBook(user.id)
    await setShelfBook(db(), user.id, s.id, CODE_BOOK, true)
    await setShelfBook(db(), user.id, s.id, book, true)
    const [listed] = await listShelves(db(), user.id)
    expect(listed?.books).toEqual([book, CODE_BOOK, PRIDE])
  })

  it('refuses a name another of the user’s shelves has, by key, but not one another user has', async () => {
    const alice = await newUser()
    const bob = await newUser()
    const first = await shelf(alice.id, 'To read')
    expect(await createShelf(db(), alice.id, named('TO RÉAD'), null)).toBe('duplicate')
    expect((await shelf(bob.id, 'To read')).name).toBe('To read')
    const other = await shelf(alice.id, 'Later')
    expect(await renameShelf(db(), alice.id, other.id, named('to read'))).toBe('duplicate')
    expect(await renameShelf(db(), alice.id, first.id, named('To Read'))).toEqual({
      id: first.id,
      name: 'To Read',
      books: [],
    })
  })

  it('leaves one shelf when two creates of one name race', async () => {
    const user = await newUser()
    const results = await Promise.all([
      createShelf(db(), user.id, named('To read'), PRIDE),
      createShelf(db(), user.id, named('to read'), CODE_BOOK),
    ])
    expect(results.filter((r) => r === 'duplicate')).toHaveLength(1)
    expect(await raw`select 1 from shelves`).toHaveLength(1)
    expect(await raw`select 1 from shelf_books`).toHaveLength(1)
  })

  it('answers missing for another user’s shelf, and for an id that isn’t a UUID', async () => {
    const alice = await newUser()
    const bob = await newUser()
    const mine = await shelf(alice.id, 'Mine', PRIDE)
    expect(await renameShelf(db(), bob.id, mine.id, named('Taken'))).toBe('missing')
    expect(await deleteShelf(db(), bob.id, mine.id)).toBe('missing')
    expect(await setShelfBook(db(), bob.id, mine.id, CODE_BOOK, true)).toBe('missing')
    expect(await setShelfBook(db(), bob.id, mine.id, PRIDE, false)).toBe('missing')
    expect(await renameShelf(db(), alice.id, 'not-a-uuid', named('X'))).toBe('missing')
    expect(await deleteShelf(db(), alice.id, 'not-a-uuid')).toBe('missing')
    expect(await setShelfBook(db(), alice.id, 'not-a-uuid', PRIDE, true)).toBe('missing')
    expect(await renameShelf(db(), alice.id, NOWHERE, named('X'))).toBe('missing')
    expect((await listShelves(db(), alice.id))[0]).toEqual({ id: mine.id, name: 'Mine', books: [PRIDE] })
  })

  it('refuses another user’s private book, and one still uploading, leaving no shelf behind', async () => {
    const alice = await newUser()
    const bob = await newUser()
    const hers = await privateBook(alice.id)
    const uploading = await privateBook(bob.id, false)
    expect(await createShelf(db(), bob.id, named('Stolen'), hers)).toBe('missing')
    expect(await createShelf(db(), bob.id, named('Early'), uploading)).toBe('missing')
    expect(await raw`select 1 from shelves`).toHaveLength(0)
    const own = await shelf(bob.id, 'Own')
    expect(await setShelfBook(db(), bob.id, own.id, hers, true)).toBe('missing')
    expect(await setShelfBook(db(), bob.id, own.id, uploading, true)).toBe('missing')
    expect(await raw`select 1 from shelf_books`).toHaveLength(0)
  })

  it('lists a private row only while its book is the user’s and ready', async () => {
    const user = await newUser()
    const book = await privateBook(user.id)
    const s = await shelf(user.id, 'Mine', book)
    await raw`update user_books set status = 'uploading' where id = ${book.userBookId}`
    expect((await listShelves(db(), user.id))[0]?.books).toEqual([])
    await raw`update user_books set status = 'ready' where id = ${book.userBookId}`
    expect((await listShelves(db(), user.id))[0]?.books).toEqual([book])
    expect(s.books).toEqual([book])
  })

  it('puts a book on once, and taking off one that isn’t there is fine', async () => {
    const user = await newUser()
    const s = await shelf(user.id, 'To read', PRIDE)
    expect(await setShelfBook(db(), user.id, s.id, PRIDE, true)).toEqual({ id: s.id, name: 'To read', books: [PRIDE] })
    expect(await raw`select 1 from shelf_books`).toHaveLength(1)
    expect(await setShelfBook(db(), user.id, s.id, CODE_BOOK, false)).toEqual({
      id: s.id,
      name: 'To read',
      books: [PRIDE],
    })
    expect(await setShelfBook(db(), user.id, s.id, PRIDE, false)).toEqual({ id: s.id, name: 'To read', books: [] })
    expect(await raw`select 1 from shelves`).toHaveLength(1)
  })

  it('deletes a shelf with what was on it, but not the books', async () => {
    const user = await newUser()
    const book = await privateBook(user.id)
    const s = await shelf(user.id, 'Gone', book)
    await setShelfBook(db(), user.id, s.id, PRIDE, true)
    expect(await deleteShelf(db(), user.id, s.id)).toBe(true)
    expect(await deleteShelf(db(), user.id, s.id)).toBe('missing')
    expect(await raw`select 1 from shelf_books`).toHaveLength(0)
    expect(await raw`select 1 from user_books where id = ${book.userBookId}`).toHaveLength(1)
  })

  it('cascades when the private book or the user is deleted', async () => {
    const user = await newUser()
    const book = await privateBook(user.id)
    const s = await shelf(user.id, 'Both', book)
    await setShelfBook(db(), user.id, s.id, PRIDE, true)
    expect(await deleteBook(db(), user.id, book.userBookId)).toBe(true)
    expect(await raw`select book_slug from shelf_books`).toEqual([{ book_slug: 'pride-and-prejudice' }])
    await raw`delete from users where id = ${user.id}`
    expect(await raw`select 1 from shelves`).toHaveLength(0)
    expect(await raw`select 1 from shelf_books`).toHaveLength(0)
  })
})

describe('the quotas', () => {
  it('allow 50 shelves per user', async () => {
    const user = await newUser()
    await raw`
      insert into shelves (user_id, name, name_key)
      select ${user.id}, 'Shelf ' || g, 'shelf ' || g from generate_series(1, ${MAX_SHELVES_PER_USER}) g`
    expect(await createShelf(db(), user.id, named('One more'), null)).toBe('quota-shelves')
    const other = await newUser()
    expect((await shelf(other.id, 'One more')).name).toBe('One more')
  })

  it('allow 2,000 books on shelves per user, counting a book once per shelf', async () => {
    const user = await newUser()
    await fillBooks(user.id, MAX_SHELF_BOOKS_PER_USER - 1)
    const s = await shelf(user.id, 'Last', PRIDE)
    expect(s.books).toEqual([PRIDE])
    expect(await setShelfBook(db(), user.id, s.id, CODE_BOOK, true)).toBe('quota-books')
    expect(await createShelf(db(), user.id, named('With a book'), CODE_BOOK)).toBe('quota-books')
    const empty = await shelf(user.id, 'Empty')
    expect(await setShelfBook(db(), user.id, s.id, PRIDE, true)).toEqual({ id: s.id, name: 'Last', books: [PRIDE] })
    await setShelfBook(db(), user.id, s.id, PRIDE, false)
    expect((await setShelfBook(db(), user.id, empty.id, PRIDE, true)) as ShelfRow).toMatchObject({ books: [PRIDE] })
  })

  it('let only one of two parallel puts take the last slot', async () => {
    const user = await newUser()
    await fillBooks(user.id, MAX_SHELF_BOOKS_PER_USER - 1)
    const s = await shelf(user.id, 'Race')
    const results = await Promise.all([
      setShelfBook(db(), user.id, s.id, PRIDE, true),
      setShelfBook(db(), user.id, s.id, CODE_BOOK, true),
    ])
    expect(results.filter((r) => r === 'quota-books')).toHaveLength(1)
  })
})

describe('the view', () => {
  it('drops slugs no longer in the catalogue, names private books u-<uuid>, and sorts shelves by name', async () => {
    const user = await newUser()
    const book = await privateBook(user.id)
    const later = await shelf(user.id, 'Shelf 10', CODE_BOOK)
    await setShelfBook(db(), user.id, later.id, PRIDE, true)
    await setShelfBook(db(), user.id, later.id, book, true)
    await shelf(user.id, 'shelf 2')
    await shelf(user.id, 'Älter')
    const views = toShelfViews(await listShelves(db(), user.id), new Set(['pride-and-prejudice']))
    expect(views.map((v) => v.name)).toEqual(['Älter', 'shelf 2', 'Shelf 10'])
    expect(views[2]?.books).toEqual([slugOf(book), 'pride-and-prejudice'])
    expect(await raw`select 1 from shelf_books where book_slug = 'fixture-code-book'`).toHaveLength(1)
  })
})

describe('the endpoints', () => {
  const origin = getConfig().appOrigin
  const cookieName = getConfig().cookieSecure ? '__Host-session' : 'session'

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

  const DEFAULT = { name: 'To read', book: 'pride-and-prejudice' }
  const create = (cookie: string | null, body: unknown = DEFAULT, headers: Record<string, string> = {}) =>
    handleShelfCreate(post('/account/shelves/new', cookie, body, headers))
  const change = (cookie: string | null, id: string, body: unknown) =>
    handleShelfChange(post(`/account/shelves/${id}`, cookie, body), id)
  const book = (cookie: string | null, id: string, body: unknown) =>
    handleShelfBook(post(`/account/shelves/${id}/books`, cookie, body), id)

  const answer = async (response: Response) => [
    response.status,
    response.status === 403 ? null : (((await response.json()) as { error?: string }).error ?? null),
  ]
  const shelfOf = async (response: Response) => ((await response.json()) as { shelf: ShelfView }).shelf

  it('makes, fills, renames and deletes a shelf, answering what was stored', async () => {
    const { user, cookie } = await signedIn()
    const made = await create(cookie, { name: '  To   read ', book: 'pride-and-prejudice' })
    expect(made.status).toBe(201)
    expect(made.headers.get('cache-control')).toBe('private, no-store')
    const created = await shelfOf(made)
    expect(created).toEqual({ id: expect.any(String), name: 'To read', books: ['pride-and-prejudice'] })
    expect(await raw`select name, name_key from shelves`).toEqual([{ name: 'To read', name_key: 'to read' }])

    const own = await privateBook(user.id)
    const on = await book(cookie, created.id, { book: slugOf(own), on: true })
    expect([on.status, await shelfOf(on)]).toEqual([
      200,
      { id: created.id, name: 'To read', books: [slugOf(own), 'pride-and-prejudice'] },
    ])
    const off = await book(cookie, created.id, { book: 'pride-and-prejudice', on: false })
    expect((await shelfOf(off)).books).toEqual([slugOf(own)])

    const renamed = await change(cookie, created.id, { name: 'Next up' })
    expect([renamed.status, (await shelfOf(renamed)).name]).toEqual([200, 'Next up'])
    const deleted = await change(cookie, created.id, { intent: 'delete' })
    expect([deleted.status, await deleted.json()]).toEqual([200, { deleted: true }])
    expect(await raw`select 1 from shelves`).toHaveLength(0)
    expect(await answer(await change(cookie, created.id, { intent: 'delete' }))).toEqual([404, 'not_found'])

    expect((await shelfOf(await create(cookie, { name: 'Empty' }))).books).toEqual([])
  })

  it('maps every refusal to its status and code', async () => {
    const { cookie } = await signedIn()
    expect(await answer(await create(null))).toEqual([401, 'signed_out'])
    expect(await answer(await create(cookie, { name: '' }))).toEqual([400, 'invalid'])
    expect(await answer(await create(cookie, { name: 'X', colour: 'red' }))).toEqual([400, 'invalid'])
    expect(await answer(await create(cookie, { name: 'X', book: 'no-such-book' }))).toEqual([404, 'not_found'])
    expect(await answer(await create(cookie, 'not json'))).toEqual([400, 'invalid'])
    const made = await shelfOf(await create(cookie))
    expect(await answer(await create(cookie, { name: 'TO READ' }))).toEqual([409, 'duplicate'])

    expect(await answer(await change(null, made.id, { name: 'X' }))).toEqual([401, 'signed_out'])
    expect(await answer(await change(cookie, 'not-a-uuid', { name: 'X' }))).toEqual([404, 'not_found'])
    expect(await answer(await change(cookie, NOWHERE, { name: 'X' }))).toEqual([404, 'not_found'])
    expect(await answer(await change(cookie, made.id, { name: 'X', intent: 'delete' }))).toEqual([400, 'invalid'])
    expect(await answer(await change(cookie, made.id, '{'))).toEqual([400, 'invalid'])
    await create(cookie, { name: 'Other' })
    expect(await answer(await change(cookie, made.id, { name: 'other' }))).toEqual([409, 'duplicate'])

    const pride = { book: 'pride-and-prejudice', on: true }
    expect(await answer(await book(null, made.id, pride))).toEqual([401, 'signed_out'])
    expect(await answer(await book(cookie, 'nope', pride))).toEqual([404, 'not_found'])
    expect(await answer(await book(cookie, made.id, { ...pride, on: 1 }))).toEqual([400, 'invalid'])
    expect(await answer(await book(cookie, made.id, { ...pride, book: 'no-such-book' }))).toEqual([404, 'not_found'])
    expect(await answer(await book(cookie, NOWHERE, pride))).toEqual([404, 'not_found'])
  })

  it('answers 404 to another user, for shelves and private books alike', async () => {
    const alice = await signedIn()
    const bob = await signedIn()
    const hers = await shelfOf(await create(alice.cookie))
    expect(await answer(await change(bob.cookie, hers.id, { name: 'Mine now' }))).toEqual([404, 'not_found'])
    expect(await answer(await change(bob.cookie, hers.id, { intent: 'delete' }))).toEqual([404, 'not_found'])
    const off = { book: 'pride-and-prejudice', on: false }
    expect(await answer(await book(bob.cookie, hers.id, off))).toEqual([404, 'not_found'])
    const own = await privateBook(alice.user.id)
    const peek = { name: 'Peek', book: slugOf(own) }
    expect(await answer(await create(bob.cookie, peek))).toEqual([404, 'not_found'])
    const bobs = await shelfOf(await create(bob.cookie, { name: 'Bob' }))
    const put = { book: slugOf(own), on: true }
    expect(await answer(await book(bob.cookie, bobs.id, put))).toEqual([404, 'not_found'])
    expect(await raw`select name from shelves where user_id = ${alice.user.id}`).toEqual([{ name: 'To read' }])
  })

  it('says quota with its scope and limit, for shelves and for books on them', async () => {
    const { user, cookie } = await signedIn()
    await raw`
      insert into shelves (user_id, name, name_key)
      select ${user.id}, 'Shelf ' || g, 'shelf ' || g from generate_series(1, ${MAX_SHELVES_PER_USER}) g`
    const full = await create(cookie)
    expect([full.status, await full.json()]).toEqual([
      409,
      { error: 'quota', scope: 'shelves', max: MAX_SHELVES_PER_USER },
    ])

    const other = await signedIn()
    await fillBooks(other.user.id, MAX_SHELF_BOOKS_PER_USER)
    const withBook = await create(other.cookie)
    const quotaBooks = { error: 'quota', scope: 'shelf_books', max: MAX_SHELF_BOOKS_PER_USER }
    expect([withBook.status, await withBook.json()]).toEqual([409, quotaBooks])
    const empty = await shelfOf(await create(other.cookie, { name: 'Empty' }))
    const put = await book(other.cookie, empty.id, { book: 'pride-and-prejudice', on: true })
    expect([put.status, await put.json()]).toEqual([409, quotaBooks])
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
      expect(await answer(await create(cookie, { name: 'Secret name' }))).toEqual([500, 'failed'])
      vi.mocked(getDb).mockReturnValueOnce(real).mockReturnValueOnce(broken)
      expect(await answer(await change(cookie, NOWHERE, { name: 'Secret name' }))).toEqual([500, 'failed'])
      vi.mocked(getDb).mockReturnValueOnce(real).mockReturnValueOnce(broken)
      const pride = { book: 'pride-and-prejudice', on: true }
      expect(await answer(await book(cookie, NOWHERE, pride))).toEqual([500, 'failed'])
      vi.mocked(getDb).mockReturnValueOnce(real).mockReturnValueOnce(broken)
      expect(await shelvesState(post('/library', cookie, {}))).toEqual({ state: 'unavailable' })
      const lines = errors.mock.calls.map((call) => String(call[0]))
      expect(lines).toEqual([
        expect.stringMatching(/^\[shelf create\] /),
        expect.stringMatching(/^\[shelf change\] /),
        expect.stringMatching(/^\[shelf book\] /),
        expect.stringMatching(/^\[shelves\] /),
      ])
      expect(lines.join('\n')).not.toContain('Secret name')
    } finally {
      errors.mockRestore()
    }
  })

  it('reads signed out without a session, and only the reader’s own shelves when signed in', async () => {
    const read = (cookie: string | null) =>
      shelvesState(new Request(`${origin}/library`, { headers: cookie ? { cookie } : {} }))
    const alice = await signedIn()
    const bob = await signedIn()
    expect(await read(null)).toEqual({ state: 'signed_out' })
    expect(await read(alice.cookie)).toEqual({ state: 'ready', shelves: [] })
    const made = await shelfOf(await create(alice.cookie))
    await create(alice.cookie, { name: 'Another' })
    expect(await read(alice.cookie)).toEqual({
      state: 'ready',
      shelves: [
        { id: expect.any(String), name: 'Another', books: [] },
        { id: made.id, name: 'To read', books: ['pride-and-prejudice'] },
      ],
    })
    expect(await read(bob.cookie)).toEqual({ state: 'ready', shelves: [] })
  })
})
