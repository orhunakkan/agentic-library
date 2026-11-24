import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getConfig } from '~/server/config'
import { closeDb, getDb, type Pool } from '~/server/db'
import { privateBookSlug } from '~/shared/content/book-slug'
import { NO_DETAILS } from '../../shared/import/details.ts'
import { testUser } from '../testing/users'

vi.mock('~/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/server/db')>()
  return { ...actual, getDb: vi.fn(actual.getDb) }
})

import { type BookRef, slugOf } from '~/server/books/ref'
import { handleRating, ratingState } from '~/server/ratings/actions'
import { clearRating, getRating, setRating } from '~/server/ratings/store'
import { hashToken, newSessionToken } from '~/server/security'
import { createSession } from '~/server/sessions'
import { deleteBook, finishImport, startImport, storeChapter } from '~/server/user-books'
import { databaseUrl, freshDatabase } from '../testing/db'

const raw = postgres(databaseUrl, { max: 1, onnotice: () => {} })
const db = () => getDb()

beforeAll(freshDatabase)
afterAll(async () => {
  await raw.end()
  await closeDb()
})
beforeEach(async () => {
  await raw`truncate users, sessions, login_attempts, audit_events, user_books, book_ratings restart identity cascade`
})

let users = 0
const newUser = () => testUser(db(), `reader-${++users}`, '$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA', 'member')

const PROPHET: BookRef = { slug: 'the-prophet', userBookId: null }
const NOWHERE = '6f1c0000-0000-4000-8000-000000000000'

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

const rows = () =>
  raw<{ user_id: string; book_slug: string | null; user_book_id: string | null; stars: number; rated_at: Date }[]>`
    select user_id, book_slug, user_book_id, stars, rated_at from book_ratings order by rated_at`

describe('the store', () => {
  it('rates each kind of book twice, keeping one row whose stars and time move', async () => {
    const user = await newUser()
    const mine = await privateBook(user.id)
    for (const book of [PROPHET, mine]) {
      expect(await getRating(db(), user.id, book)).toBeNull()
      expect(await setRating(db(), user.id, book, 3)).toBe('ok')
      const [first] = (await rows()).filter((r) => (book.slug ? r.book_slug : r.user_book_id))
      expect(await setRating(db(), user.id, book, 5)).toBe('ok')
      const now = (await rows()).filter((r) => (book.slug ? r.book_slug : r.user_book_id))
      expect(now).toHaveLength(1)
      expect(now[0]?.stars).toBe(5)
      expect(now[0]?.rated_at.getTime()).toBeGreaterThanOrEqual(first?.rated_at.getTime() ?? Infinity)
      expect(await getRating(db(), user.id, book)).toBe(5)
    }
    expect(await rows()).toHaveLength(2)
  })

  it('clears a rating, and clearing an unrated book is fine', async () => {
    const user = await newUser()
    const mine = await privateBook(user.id)
    expect(await clearRating(db(), user.id, PROPHET)).toBe('ok')
    await setRating(db(), user.id, PROPHET, 4)
    await setRating(db(), user.id, mine, 2)
    expect(await clearRating(db(), user.id, PROPHET)).toBe('ok')
    expect(await getRating(db(), user.id, PROPHET)).toBeNull()
    expect(await getRating(db(), user.id, mine)).toBe(2)
    expect(await clearRating(db(), user.id, mine)).toBe('ok')
    expect(await clearRating(db(), user.id, mine)).toBe('ok')
    expect(await rows()).toHaveLength(0)
  })

  it('treats another reader’s private book, one still uploading and one that never was as missing', async () => {
    const ada = await newUser()
    const bob = await newUser()
    const adas = await privateBook(ada.id)
    const uploading = await privateBook(bob.id, false)
    const nowhere: BookRef = { slug: null, userBookId: NOWHERE }
    for (const book of [adas, uploading, nowhere]) {
      expect(await setRating(db(), bob.id, book, 4)).toBe('missing')
      expect(await clearRating(db(), bob.id, book)).toBe('missing')
    }
    expect(await rows()).toHaveLength(0)
    await setRating(db(), ada.id, adas, 5)
    expect(await getRating(db(), bob.id, adas)).toBeNull()
    expect(await clearRating(db(), bob.id, adas)).toBe('missing')
    expect(await getRating(db(), ada.id, adas)).toBe(5)
  })

  it('keeps each reader’s catalogue ratings to themselves', async () => {
    const ada = await newUser()
    const bob = await newUser()
    await setRating(db(), ada.id, PROPHET, 2)
    expect(await getRating(db(), bob.id, PROPHET)).toBeNull()
    await setRating(db(), bob.id, PROPHET, 5)
    await clearRating(db(), bob.id, PROPHET)
    expect(await getRating(db(), ada.id, PROPHET)).toBe(2)
  })

  it('reads a private book’s rating only while the book is ready', async () => {
    const user = await newUser()
    const mine = await privateBook(user.id)
    await setRating(db(), user.id, mine, 3)
    await raw`update user_books set status = 'uploading' where id = ${mine.userBookId}`
    expect(await getRating(db(), user.id, mine)).toBeNull()
  })

  it('goes with the private book, and with the user', async () => {
    const user = await newUser()
    const mine = await privateBook(user.id)
    await setRating(db(), user.id, mine, 3)
    await setRating(db(), user.id, PROPHET, 4)
    await deleteBook(db(), user.id, mine.userBookId)
    expect((await rows()).map((r) => r.book_slug)).toEqual(['the-prophet'])
    await raw`delete from users where id = ${user.id}`
    expect(await rows()).toHaveLength(0)
  })

  it('treats a private book deleted while it is rated as missing', async () => {
    const user = await newUser()
    const mine = await privateBook(user.id)
    let deleted: () => void = () => {}
    let commit: () => void = () => {}
    const isDeleted = new Promise<void>((resolve) => {
      deleted = resolve
    })
    const canCommit = new Promise<void>((resolve) => {
      commit = resolve
    })
    const deleting = raw.begin(async (tx) => {
      await tx`delete from user_books where id = ${mine.userBookId}`
      deleted()
      await canCommit
    })
    await isDeleted
    const rating = setRating(db(), user.id, mine, 4)
    await expect
      .poll(async () => {
        const [row] = await db()<{ n: string }[]>`
          select count(*) as n from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database()`
        return Number(row?.n ?? 0)
      })
      .toBeGreaterThan(0)
    commit()
    await deleting
    expect(await rating).toBe('missing')
    expect(await rows()).toHaveLength(0)
  })

  it('passes on any other database error', async () => {
    const user = await newUser()
    const mine = await privateBook(user.id)
    const failing = (() => {
      const query = Promise.reject(Object.assign(new Error('gone away'), { code: '57P01' }))
      query.catch(() => {})
      return query
    }) as unknown as Pool
    await expect(setRating(failing, user.id, mine, 4)).rejects.toThrow('gone away')
  })

  it('refuses stars outside one to five, and a row about two books or none', async () => {
    const user = await newUser()
    const mine = await privateBook(user.id)
    await expect(
      raw`insert into book_ratings (user_id, book_slug, stars) values (${user.id}, 'the-prophet', 6)`,
    ).rejects.toThrow(/book_ratings_stars_check/)
    await expect(
      raw`insert into book_ratings (user_id, book_slug, stars) values (${user.id}, 'the-prophet', 0)`,
    ).rejects.toThrow(/book_ratings_stars_check/)
    await expect(
      raw`insert into book_ratings (user_id, book_slug, user_book_id, stars)
        values (${user.id}, 'the-prophet', ${mine.userBookId}, 3)`,
    ).rejects.toThrow(/book_ratings_check/)
    await expect(raw`insert into book_ratings (user_id, stars) values (${user.id}, 3)`).rejects.toThrow(
      /book_ratings_check/,
    )
  })
})

describe('the endpoint and the read', () => {
  const origin = getConfig().appOrigin
  const cookieName = getConfig().cookieSecure ? '__Host-session' : 'session'

  async function signedIn() {
    const user = await newUser()
    const token = newSessionToken()
    await createSession(db(), { tokenHash: hashToken(token), userId: user.id, ip: null, userAgent: 'test' })
    return { user, cookie: `${cookieName}=${token}` }
  }

  const post = (cookie: string | null, body: unknown) =>
    handleRating(
      new Request(`${origin}/account/ratings`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
    )
  const get = (cookie: string | null) => new Request(`${origin}/`, { headers: cookie ? { cookie } : {} })

  const answer = async (response: Response) => [
    response.status,
    ((await response.json()) as { error?: string }).error ?? null,
  ]

  const PRIDE = 'pride-and-prejudice'

  it('rates and clears a catalogue book, answering its rating afterwards', async () => {
    const { user, cookie } = await signedIn()
    const rated = await post(cookie, { book: PRIDE, stars: 4 })
    expect([rated.status, await rated.json()]).toEqual([200, { book: PRIDE, stars: 4 }])
    expect(rated.headers.get('cache-control')).toBe('private, no-store')
    expect(await getRating(db(), user.id, { slug: PRIDE, userBookId: null })).toBe(4)

    const cleared = await post(cookie, { book: PRIDE, stars: null })
    expect([cleared.status, await cleared.json()]).toEqual([200, { book: PRIDE, stars: null }])
    expect(await getRating(db(), user.id, { slug: PRIDE, userBookId: null })).toBeNull()
    expect((await post(cookie, { book: PRIDE, stars: null })).status).toBe(200)
    expect(await rows()).toHaveLength(0)
  })

  it('rates and clears the reader’s private book', async () => {
    const { user, cookie } = await signedIn()
    const mine = await privateBook(user.id)
    const slug = slugOf(mine)
    const rated = await post(cookie, { book: slug, stars: 2 })
    expect([rated.status, await rated.json()]).toEqual([200, { book: slug, stars: 2 }])
    expect(await getRating(db(), user.id, mine)).toBe(2)
    expect((await post(cookie, { book: slug, stars: null })).status).toBe(200)
    expect(await getRating(db(), user.id, mine)).toBeNull()
  })

  it('maps every refusal to its status and code, and stores nothing', async () => {
    const { cookie } = await signedIn()
    const other = await newUser()
    const theirs = await privateBook(other.id)
    const body = { book: PRIDE, stars: 4 }
    expect(await answer(await post(null, body))).toEqual([401, 'signed_out'])
    expect(await answer(await post(cookie, 'not json'))).toEqual([400, 'invalid'])
    for (const refused of [
      { book: PRIDE },
      { book: PRIDE, stars: 0 },
      { book: PRIDE, stars: 6 },
      { book: PRIDE, stars: 2.5 },
      { book: PRIDE, stars: '4' },
      { book: PRIDE, stars: 4, extra: true },
      { book: 'u-not-a-uuid', stars: 4 },
    ]) {
      expect(await answer(await post(cookie, refused))).toEqual([400, 'invalid'])
    }
    expect(await answer(await post(cookie, { book: 'no-such-book', stars: 4 }))).toEqual([404, 'not_found'])
    expect(await answer(await post(cookie, { book: 'no-such-book', stars: null }))).toEqual([404, 'not_found'])
    expect(await answer(await post(cookie, { book: slugOf(theirs), stars: 4 }))).toEqual([404, 'not_found'])
    expect(await answer(await post(cookie, { book: slugOf(theirs), stars: null }))).toEqual([404, 'not_found'])
    expect(await answer(await post(cookie, { book: privateBookSlug(NOWHERE), stars: 4 }))).toEqual([404, 'not_found'])
    expect(await rows()).toHaveLength(0)
  })

  it('reads the rating, and as hidden signed out; Pride and Prejudice like any catalogue book', async () => {
    const { user, cookie } = await signedIn()
    expect(await ratingState(get(cookie), 'the-prophet')).toEqual({ state: 'ready', stars: null })
    await setRating(db(), user.id, PROPHET, 4)
    expect(await ratingState(get(cookie), 'the-prophet')).toEqual({ state: 'ready', stars: 4 })
    expect(await ratingState(get(null), 'the-prophet')).toEqual({ state: 'hidden' })
    expect(await ratingState(get(cookie), PRIDE)).toEqual({ state: 'ready', stars: null })
    await setRating(db(), user.id, { slug: PRIDE, userBookId: null }, 5)
    expect(await ratingState(get(cookie), PRIDE)).toEqual({ state: 'ready', stars: 5 })
  })

  it('answers failed, and reads as unavailable, when the database fails, and logs no body', async () => {
    const { cookie } = await signedIn()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = (() => {
      throw new Error('the database went away')
    }) as unknown as Pool
    const real = getDb()
    try {
      vi.mocked(getDb).mockReturnValueOnce(real).mockReturnValueOnce(broken)
      expect(await answer(await post(cookie, { book: PRIDE, stars: 4 }))).toEqual([500, 'failed'])
      vi.mocked(getDb).mockReturnValueOnce(real).mockReturnValueOnce(broken)
      expect(await ratingState(get(cookie), 'the-prophet')).toEqual({ state: 'unavailable' })
      const lines = errors.mock.calls.map((call) => String(call[0]))
      expect(lines).toEqual([expect.stringMatching(/^\[rating\] /), expect.stringMatching(/^\[rating read\] /)])
      expect(lines.join('\n')).not.toContain(PRIDE)
      expect(lines.join('\n')).not.toContain('the-prophet')
    } finally {
      errors.mockRestore()
    }
  })
})
