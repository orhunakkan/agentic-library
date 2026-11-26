import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getConfig } from '~/server/config'
import { closeDb, getDb, type Pool } from '~/server/db'
import { privateBookSlug } from '~/shared/content/book-slug'
import { testUser } from '../testing/users'

vi.mock('~/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/server/db')>()
  return { ...actual, getDb: vi.fn(actual.getDb) }
})

import { type BookRef, refFor } from '~/server/books/ref'
import { handleCardChange, handleCardSave, handleFlashcardsForm } from '~/server/flashcards/actions'
import { bookFlashcardsState, flashcardBooksState } from '~/server/flashcards/page'
import { bookCards, cardBooks, dueCards, reviewCard, saveCard } from '~/server/flashcards/store'
import { hashToken, newSessionToken } from '~/server/security'
import { createSession } from '~/server/sessions'
import { deleteBook, finishImport, startImport, storeChapter } from '~/server/user-books'
import type { FlashcardView } from '~/shared/flashcards/contract'
import { MAX_CARDS_PER_BOOK, MAX_CARDS_PER_USER } from '~/shared/flashcards/limits'
import { DEFAULT_LIMITS } from '~/shared/limits/limits'
import { NO_DETAILS } from '../../shared/import/details.ts'
import { databaseUrl, freshDatabase } from '../testing/db'

const raw = postgres(databaseUrl, { max: 1, onnotice: () => {} })
const db = () => getDb()

beforeAll(freshDatabase)
afterAll(async () => {
  await raw.end()
  await closeDb()
})
beforeEach(async () => {
  await raw`truncate users, sessions, login_attempts, api_keys, audit_events, user_books, flashcards restart identity cascade`
})

const origin = getConfig().appOrigin
const cookieName = getConfig().cookieSecure ? '__Host-session' : 'session'
const PRIDE: BookRef = refFor('pride-and-prejudice')
const DAY = 86_400_000

let users = 0
/** A plain member: no grant and no subscription, so every case shows Flashcards work for any account. */
async function signedIn() {
  const user = await testUser(db(), `reader-${++users}`, '$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA', 'member')
  const token = newSessionToken()
  await createSession(db(), { tokenHash: hashToken(token), userId: user.id, ip: null, userAgent: 'test' })
  return { user, cookie: `${cookieName}=${token}` }
}

async function privateBook(userId: number, title = 'Notes') {
  const start = await startImport(
    db(),
    userId,
    {
      title,
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
    { title: 'Only', pages: ['<p>One.</p>', '<p>Two.</p>'] },
    DEFAULT_LIMITS,
  )
  expect(await finishImport(db(), userId, start.id, null)).toBe('ok')
  return { id: start.id, slug: privateBookSlug(start.id) }
}

const post = (path: string, cookie: string | null, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${origin}${path}`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

const saveBody = (over: Record<string, unknown> = {}) => ({
  book: 'pride-and-prejudice',
  front: 'Who is Mr. Darcy?',
  back: 'A rich and proud gentleman.',
  position: { chapter: 'chapter-3', page: 2 },
  origin: 'flashcards',
  ...over,
})
const save = (cookie: string | null, over: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  handleCardSave(post('/account/flashcards/new', cookie, saveBody(over), headers))
const change = (cookie: string | null, id: string, body: unknown) =>
  handleCardChange(post(`/account/flashcards/${id}`, cookie, body), id)
const answer = async (response: Response) => [
  response.status,
  response.status === 403 ? null : (((await response.json()) as { error?: string }).error ?? null),
]
async function saved(cookie: string, over: Record<string, unknown> = {}) {
  const response = await save(cookie, over)
  expect(response.status).toBe(201)
  return ((await response.json()) as { card: FlashcardView }).card
}
const pageRequest = (cookie: string | null) =>
  new Request(`${origin}/account/flashcards`, { headers: cookie ? { cookie } : {} })

describe('the flashcards table', () => {
  it('belongs to exactly one book, and refuses out-of-range values', async () => {
    const { user } = await signedIn()
    const book = await privateBook(user.id)
    const insert = (slug: string | null, bookId: string | null, front = 'f', back = 'b', box = 0) =>
      raw`insert into flashcards (user_id, book_slug, user_book_id, page, front, back, origin, box)
          values (${user.id}, ${slug}, ${bookId}, 1, ${front}, ${back}, 'quiz', ${box})`
    await expect(insert(null, null)).rejects.toThrow(/check/)
    await expect(insert('pride-and-prejudice', book.id)).rejects.toThrow(/check/)
    await expect(insert('pride-and-prejudice', null, '')).rejects.toThrow(/check/)
    await expect(insert('pride-and-prejudice', null, 'f'.repeat(201))).rejects.toThrow(/check/)
    await expect(insert('pride-and-prejudice', null, 'f', 'b'.repeat(501))).rejects.toThrow(/check/)
    await expect(insert('pride-and-prejudice', null, 'f', 'b', 6)).rejects.toThrow(/check/)
    await insert('pride-and-prejudice', null)
    await expect(insert('pride-and-prejudice', null)).rejects.toThrow(/unique/)
    await insert(null, book.id)
  })
})

describe('POST /account/flashcards/new', () => {
  it('saves a card on a catalogue book with the server’s page label, and the same front again is the same card', async () => {
    const { user, cookie } = await signedIn()
    const response = await save(cookie)
    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const body = (await response.json()) as { card: FlashcardView; existed: boolean }
    expect(body).toEqual({
      existed: false,
      card: {
        id: expect.any(String),
        front: 'Who is Mr. Darcy?',
        back: 'A rich and proud gentleman.',
        source: { pageHref: '/read/pride-and-prejudice/chapter-3/2', label: 'Ch. 3 · p. 2' },
        box: 0,
        dueAt: expect.any(String),
        createdAt: expect.any(String),
      },
    })
    expect(new Date(body.card.dueAt).getTime()).toBeLessThanOrEqual(Date.now())
    const [stored] = await raw`select book_slug, chapter, page, origin from flashcards where user_id = ${user.id}`
    expect(stored).toEqual({ book_slug: 'pride-and-prejudice', chapter: 'chapter-3', page: 2, origin: 'flashcards' })

    const again = await save(cookie, { back: 'Something else', origin: 'quiz' })
    expect(again.status).toBe(200)
    expect(await again.json()).toEqual({ card: body.card, existed: true })
    expect(await raw`select 1 from flashcards`).toHaveLength(1)
  })

  it('saves a card on the reader’s own private book, by printed page or chapter', async () => {
    const { cookie, user } = await signedIn()
    const book = await privateBook(user.id)
    const card = await saved(cookie, { book: book.slug, position: { chapter: 'only', page: 2 } })
    expect(card.source).toEqual({ pageHref: `/read/${book.slug}/only/2`, label: 'Ch. 1 · p. 2' })
  })

  it('maps every refusal to its status and code', async () => {
    const { cookie } = await signedIn()
    expect(await answer(await save(null))).toEqual([401, 'signed_out'])
    expect(await answer(await save(cookie, { book: 'no-such-book' }))).toEqual([404, 'not_found'])
    expect(await answer(await save(cookie, { label: 'Ch. 99' }))).toEqual([400, 'invalid'])
    expect(await answer(await save(cookie, { front: '' }))).toEqual([400, 'invalid'])
    expect(await answer(await save(cookie, { position: { chapter: 'chapter-3', page: 99 } }))).toEqual([400, 'invalid'])
    expect(await answer(await save(cookie, { position: { printedPage: 2 } }))).toEqual([400, 'invalid'])
    expect(await answer(await handleCardSave(post('/account/flashcards/new', cookie, 'not json')))).toEqual([
      400,
      'invalid',
    ])
    expect(await raw`select 1 from flashcards`).toHaveLength(0)
  })

  it('is a 404 on another user’s private book', async () => {
    const owner = await signedIn()
    const book = await privateBook(owner.user.id)
    const other = await signedIn()
    expect(await answer(await save(other.cookie, { book: book.slug, position: { chapter: 'only', page: 1 } }))).toEqual(
      [404, 'not_found'],
    )
  })

  it('allows 1,000 cards per book and 10,000 in all (409 quota)', async () => {
    const { user, cookie } = await signedIn()
    await raw`
      insert into flashcards (user_id, book_slug, chapter, page, front, back, origin)
      select ${user.id}, 'pride-and-prejudice', 'chapter-1', 1, 'card ' || g, 'b', 'quiz'
      from generate_series(1, ${MAX_CARDS_PER_BOOK}) g`
    const full = await save(cookie)
    expect([full.status, await full.json()]).toEqual([409, { error: 'quota', scope: 'book', max: MAX_CARDS_PER_BOOK }])
    expect((await save(cookie, { front: 'card 7' })).status).toBe(200)

    const other = await signedIn()
    await raw`
      insert into flashcards (user_id, book_slug, chapter, page, front, back, origin)
      select ${other.user.id}, 'book-' || (g / ${MAX_CARDS_PER_BOOK}), 'chapter-1', 1, 'card ' || g, 'b', 'quiz'
      from generate_series(1, ${MAX_CARDS_PER_USER}) g`
    const all = await save(other.cookie)
    expect([all.status, await all.json()]).toEqual([409, { error: 'quota', scope: 'user', max: MAX_CARDS_PER_USER }])
  })
})

describe('POST /account/flashcards/<id>', () => {
  it('moves a card on from the stored box, whatever the browser thinks, and deletes it', async () => {
    const { cookie } = await signedIn()
    const card = await saved(cookie)
    await raw`update flashcards set box = 3 where id = ${card.id}`
    const good = await change(cookie, card.id, { review: 'good' })
    expect(good.status).toBe(200)
    const after = ((await good.json()) as { card: FlashcardView }).card
    expect(after).toMatchObject({ id: card.id, box: 4, source: card.source })
    const days = (new Date(after.dueAt).getTime() - Date.now()) / DAY
    expect(days).toBeGreaterThan(15.9)
    expect(days).toBeLessThanOrEqual(16)
    const [row] = await raw<{ reviewed_at: Date | null }[]>`select reviewed_at from flashcards where id = ${card.id}`
    expect(row?.reviewed_at).not.toBeNull()

    const again = ((await (await change(cookie, card.id, { review: 'again' })).json()) as { card: FlashcardView }).card
    expect(again.box).toBe(0)
    expect(new Date(again.dueAt).getTime()).toBeLessThanOrEqual(Date.now())
    expect(await answer(await change(cookie, card.id, { review: 'good', box: 5 }))).toEqual([400, 'invalid'])

    expect([(await change(cookie, card.id, { delete: true })).status]).toEqual([200])
    expect(await answer(await change(cookie, card.id, { delete: true }))).toEqual([404, 'not_found'])
  })

  it('is a 404 for another user’s card, for a review and a delete, and checks the rest', async () => {
    const owner = await signedIn()
    const card = await saved(owner.cookie)
    const other = await signedIn()
    expect(await answer(await change(other.cookie, card.id, { review: 'good' }))).toEqual([404, 'not_found'])
    expect(await answer(await change(other.cookie, card.id, { delete: true }))).toEqual([404, 'not_found'])
    expect(await raw`select box from flashcards`).toEqual([{ box: 0 }])

    expect(await answer(await change(owner.cookie, 'not-a-uuid', { delete: true }))).toEqual([404, 'not_found'])
    expect(await answer(await change(null, card.id, { delete: true }))).toEqual([401, 'signed_out'])
    expect(await answer(await change(owner.cookie, card.id, { intent: 'delete' }))).toEqual([400, 'invalid'])
  })
})

describe('POST /account/flashcards, the form', () => {
  const form = (cookie: string, body: string) =>
    handleFlashcardsForm(
      new Request(`${origin}/account/flashcards`, {
        method: 'POST',
        headers: { origin, cookie, 'content-type': 'application/x-www-form-urlencoded' },
        body,
      }),
    )

  it('deletes a book’s cards, and answers a missing book or an unknown intent on the page', async () => {
    const { cookie } = await signedIn()
    await saved(cookie)
    await saved(cookie, { front: 'Who is Elizabeth?' })
    const deleted = await form(cookie, 'intent=delete-book&book=pride-and-prejudice')
    expect([deleted.status, deleted.headers.get('location')]).toEqual([303, '/account/flashcards?status=deleted-book'])
    expect((await raw`select 1 from flashcards`).count).toBe(0)
    expect((await form(cookie, 'intent=delete-book&book=pride-and-prejudice')).headers.get('location')).toBe(
      '/account/flashcards?error=missing',
    )
    expect((await form(cookie, 'intent=other&book=pride-and-prejudice')).headers.get('location')).toBe(
      '/account/flashcards?error=invalid',
    )
  })

  it('answers a failing database on the page, logged', async () => {
    const { cookie } = await signedIn()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = (() => {
      throw new Error('the database went away')
    }) as unknown as Pool
    try {
      vi.mocked(getDb).mockReturnValueOnce(getDb()).mockReturnValueOnce(broken)
      const failed = await form(cookie, 'intent=delete-book&book=pride-and-prejudice')
      expect(failed.headers.get('location')).toBe('/account/flashcards?error=unavailable')
      expect(errors.mock.calls.map((call) => String(call[0]))).toEqual([expect.stringMatching(/^\[flashcards form\] /)])
    } finally {
      errors.mockRestore()
    }
  })
})

describe('a database failure', () => {
  it('answers 500 failed, and logs it without the body', async () => {
    const { cookie } = await signedIn()
    const card = await saved(cookie)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = (() => {
      throw new Error('the database went away')
    }) as unknown as Pool
    const real = getDb()
    try {
      vi.mocked(getDb).mockReturnValueOnce(real).mockReturnValueOnce(broken)
      expect(await answer(await save(cookie, { front: 'Another' }))).toEqual([500, 'failed'])
      vi.mocked(getDb).mockReturnValueOnce(real).mockReturnValueOnce(broken)
      expect(await answer(await change(cookie, card.id, { review: 'good' }))).toEqual([500, 'failed'])
      const lines = errors.mock.calls.map((call) => String(call[0]))
      expect(lines).toEqual([
        expect.stringMatching(/^\[flashcard save\] /),
        expect.stringMatching(/^\[flashcard change\] /),
      ])
      expect(lines.join('\n')).not.toContain('Mr. Darcy')
    } finally {
      errors.mockRestore()
    }
  })
})

describe('the store', () => {
  it('reviews only the user’s own card', async () => {
    const owner = await signedIn()
    const other = await signedIn()
    const result = await saveCard(db(), owner.user.id, PRIDE, {
      chapter: 'chapter-1',
      page: 1,
      front: 'f',
      back: 'b',
      origin: 'quiz',
    })
    if (typeof result === 'string') throw new Error(result)
    expect(await reviewCard(db(), other.user.id, result.row.id, 'good', new Date())).toBeNull()
    expect(await reviewCard(db(), owner.user.id, 'nope', 'good', new Date())).toBeNull()
  })

  it('lists due cards the longest overdue first, at most the limit', async () => {
    const { user } = await signedIn()
    const now = new Date()
    for (const [front, daysAgo] of [
      ['a', 1],
      ['b', 5],
      ['c', -2],
      ['d', 3],
    ] as const) {
      await raw`
        insert into flashcards (user_id, book_slug, chapter, page, front, back, origin, due_at)
        values (${user.id}, 'pride-and-prejudice', 'chapter-1', 1, ${front}, 'b', 'quiz',
          ${new Date(now.getTime() - daysAgo * DAY)})`
    }
    expect((await dueCards(db(), user.id, PRIDE, now, 20)).map((c) => c.front)).toEqual(['b', 'd', 'a'])
    expect((await dueCards(db(), user.id, PRIDE, now, 2)).map((c) => c.front)).toEqual(['b', 'd'])
    expect((await bookCards(db(), user.id, PRIDE)).map((c) => c.front)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('goes with the user and with the private book', async () => {
    const { user, cookie } = await signedIn()
    const book = await privateBook(user.id)
    await saved(cookie, { book: book.slug, position: { chapter: 'only', page: 1 } })
    await saved(cookie)
    expect(await deleteBook(db(), user.id, book.id)).toBeTruthy()
    expect(await raw`select book_slug from flashcards`).toEqual([{ book_slug: 'pride-and-prejudice' }])
    await raw`delete from users where id = ${user.id}`
    expect(await raw`select 1 from flashcards`).toHaveLength(0)
  })
})

describe('the Flashcards page reads', () => {
  it('lists every book with counts, due and the soonest due, the most recently active first', async () => {
    const { user, cookie } = await signedIn()
    const book = await privateBook(user.id, 'My Study Book')
    await saved(cookie)
    await saved(cookie, { front: 'Second' })
    const later = await saved(cookie, { book: book.slug, position: { chapter: 'only', page: 1 } })
    const [pride] = await bookCards(db(), user.id, PRIDE)
    await reviewCard(db(), user.id, pride?.id ?? '', 'good', new Date(Date.now() + 1000))
    await raw`update flashcards set created_at = now() - interval '1 day' where id = ${later.id}`

    const state = await flashcardBooksState(pageRequest(cookie))
    if (state.kind !== 'all') throw new Error(state.kind)
    expect(state.books).toEqual([
      {
        slug: 'pride-and-prejudice',
        title: 'Pride and Prejudice',
        removed: false,
        cards: 2,
        due: 1,
        nextDueAt: expect.any(String),
        activeAt: expect.any(String),
      },
      {
        slug: book.slug,
        title: 'My Study Book',
        removed: false,
        cards: 1,
        due: 1,
        nextDueAt: expect.any(String),
        activeAt: expect.any(String),
      },
    ])
    expect((await cardBooks(db(), user.id, new Date())).map((b) => b.cards)).toEqual([2, 1])
    expect(await flashcardBooksState(pageRequest(null))).toEqual({ kind: 'signed_out' })
    await raw`insert into flashcards (user_id, book_slug, page, front, back, origin)
      values (${user.id}, 'gone-book', 1, 'f', 'b', 'quiz')`
    const withGone = await flashcardBooksState(pageRequest(cookie))
    expect(withGone.kind === 'all' && withGone.books.find((b) => b.slug === 'gone-book')).toMatchObject({
      title: 'A book no longer in the library',
      removed: true,
    })
  })

  it('gives one book’s cards and its queue, with a gone page’s source null, and a 404 for others', async () => {
    const { user, cookie } = await signedIn()
    const first = await saved(cookie)
    await saved(cookie, { front: 'Later card' })
    await raw`update flashcards set page = 999 where id = ${first.id}`
    await raw`update flashcards set due_at = now() + interval '3 days' where front = 'Later card'`
    const state = await bookFlashcardsState(pageRequest(cookie), 'pride-and-prejudice')
    if (state.kind !== 'book') throw new Error(state.kind)
    expect(state.book).toEqual({
      slug: 'pride-and-prejudice',
      title: 'Pride and Prejudice',
      href: expect.stringMatching(/^\/library\/.+\/pride-and-prejudice$/),
    })
    expect(state.cards.map((c) => [c.front, c.source])).toEqual([
      ['Who is Mr. Darcy?', null],
      ['Later card', { pageHref: '/read/pride-and-prejudice/chapter-3/2', label: 'Ch. 3 · p. 2' }],
    ])
    expect(state.due.map((c) => c.front)).toEqual(['Who is Mr. Darcy?'])

    expect(await bookFlashcardsState(pageRequest(cookie), 'no-such-book')).toEqual({ kind: 'not_found' })
    const owner = await signedIn()
    const book = await privateBook(owner.user.id)
    expect(await bookFlashcardsState(pageRequest(cookie), book.slug)).toEqual({ kind: 'not_found' })
    expect(await bookFlashcardsState(pageRequest(null), 'pride-and-prejudice')).toEqual({ kind: 'signed_out' })
    const own = await bookFlashcardsState(pageRequest(owner.cookie), book.slug)
    expect(own.kind === 'book' && own.book.href).toBe(`/account/books/${book.id}`)
    expect(user.id).not.toBe(owner.user.id)
  })
})
