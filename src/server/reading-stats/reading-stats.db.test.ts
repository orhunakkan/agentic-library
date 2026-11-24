import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { refFor } from '~/server/books/ref'
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

import { handleFinished, handleGoal } from '~/server/reading-stats/actions'
import { statsState, summaryState } from '~/server/reading-stats/read'
import { listFinished, markFinished, saveTime, unmarkFinished } from '~/server/reading-stats/store'
import { hashToken, newSessionToken } from '~/server/security'
import { createSession } from '~/server/sessions'
import { deleteBook, finishImport, startImport, storeChapter } from '~/server/user-books'
import type { ReadingStatsState } from '~/shared/reading-stats/contract'
import { addDays, dayIn } from '~/shared/reading-stats/days'
import { databaseUrl, freshDatabase } from '../testing/db'

const raw = postgres(databaseUrl, { max: 1, onnotice: () => {} })
const db = () => getDb()

beforeAll(freshDatabase)
afterAll(async () => {
  await raw.end()
  await closeDb()
})
beforeEach(async () => {
  await raw`truncate users, sessions, user_books, reading_time, finished_books, reading_goals restart identity cascade`
})

let users = 0
const newUser = () => testUser(db(), `reader-${++users}`, '$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA', 'member')

const origin = getConfig().appOrigin
const cookieName = getConfig().cookieSecure ? '__Host-session' : 'session'
const PRIDE = 'pride-and-prejudice'

async function signedIn() {
  const user = await newUser()
  const token = newSessionToken()
  await createSession(db(), { tokenHash: hashToken(token), userId: user.id, ip: null, userAgent: 'test' })
  return { user, cookie: `${cookieName}=${token}` }
}

async function privateBook(userId: number, title = 'Notes'): Promise<string> {
  const start = await startImport(db(), userId, {
    title,
    author: 'Ada',
    language: 'en',
    details: NO_DETAILS,
    chapterCount: 1,
  })
  if (!start.ok) throw new Error('could not start')
  await storeChapter(db(), userId, start.id, 0, { title: 'Opening', pages: ['<p>one</p>'] })
  expect(await finishImport(db(), userId, start.id, null)).toBe('ok')
  return start.id
}

const get = (cookie: string | null) => new Request(`${origin}/account/stats`, { headers: cookie ? { cookie } : {} })
const ready = async (cookie: string) => {
  const found = await statsState(get(cookie))
  if (found.state !== 'ready') throw new Error(found.state)
  return found as Extract<ReadingStatsState, { state: 'ready' }>
}

const post = (path: string, cookie: string | null, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${origin}${path}`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
const goal = (cookie: string | null, body: unknown, headers?: Record<string, string>) =>
  handleGoal(post('/account/stats/goal', cookie, body, headers))
const finished = (cookie: string | null, body: unknown, headers?: Record<string, string>) =>
  handleFinished(post('/account/stats/finished', cookie, body, headers))
const answer = async (response: Response) => [
  response.status,
  response.status === 403 ? null : ((await response.json()) as object),
]

let sessions = 0
const session = (day: string, seconds: number, kind: 'reading' | 'listening' = 'reading') => ({
  id: `00000000-0000-4000-8000-${String(++sessions).padStart(12, '0')}`,
  kind,
  day,
  seconds,
})
const addTime = (userId: number, items: ReturnType<typeof session>[], zone: string | null = null) =>
  saveTime(db(), userId, items, zone)
const setGoalRow = (userId: number, fromDay: string, minutes: number) =>
  raw`insert into reading_goals (user_id, from_day, minutes) values (${userId}, ${fromDay}::date, ${minutes})`

describe('the store', () => {
  it('marks a book finished once, takes the mark off, and keeps each reader’s to themselves', async () => {
    const ada = await newUser()
    const bob = await newUser()
    const ref = refFor(PRIDE)
    expect(await markFinished(db(), ada.id, ref)).toBe('added')
    expect(await markFinished(db(), ada.id, ref)).toBe('exists')
    expect(await markFinished(db(), bob.id, ref)).toBe('added')
    expect(await unmarkFinished(db(), bob.id, ref)).toBe(true)
    expect(await unmarkFinished(db(), bob.id, ref)).toBe(false)
    expect((await listFinished(db(), ada.id)).map((r) => r.ref)).toEqual([ref])
    expect(await listFinished(db(), bob.id)).toEqual([])
  })

  it('marks a private book only for its owner', async () => {
    const ada = await newUser()
    const bob = await newUser()
    const id = await privateBook(ada.id)
    expect(await markFinished(db(), bob.id, privateRef(id))).toBe('missing')
    expect(await markFinished(db(), ada.id, privateRef(id))).toBe('added')
    expect(await listFinished(db(), ada.id)).toEqual([{ ref: privateRef(id), finishedAt: expect.any(Date) }])
  })

  it('refuses a session outside the column’s checks', async () => {
    const user = await newUser()
    await expect(addTime(user.id, [session('2026-11-21', 14_401)])).rejects.toThrow(/reading_time_seconds_check/)
    await expect(
      raw`insert into reading_time (user_id, id, kind, day, seconds)
          values (${user.id}, gen_random_uuid(), 'watching', '2026-11-21', 1)`,
    ).rejects.toThrow(/reading_time_kind_check/)
    await expect(setGoalRow(user.id, '2026-11-21', 0)).rejects.toThrow(/reading_goals_minutes_check/)
  })
})

describe('statsState', () => {
  it('says signed out without a session, and is ready and empty for a new reader', async () => {
    expect(await statsState(get(null))).toEqual({ state: 'signed_out' })
    expect(await summaryState(get(null))).toEqual({ state: 'signed_out' })
    const { cookie } = await signedIn()
    const stats = await ready(cookie)
    const today = dayIn(new Date(), 'UTC')
    expect(stats).toMatchObject({
      today,
      goalMinutes: 15,
      todaySeconds: 0,
      current: 0,
      best: 0,
      todayMet: false,
      toKeepSeconds: 900,
      finished: [],
      finishedThisYear: 0,
      hasAny: false,
    })
    expect(stats.week.map((d) => d.day)).toEqual(Array.from({ length: 7 }, (_, i) => addDays(today, i - 6)))
    expect(stats.totals.all).toEqual({ reading: 0, listening: 0 })
  })

  it('adds up each day in the stored zone, at most 24 hours a day, with each day’s goal and the streaks', async () => {
    const { user, cookie } = await signedIn()
    const zone = 'Pacific/Kiritimati'
    const today = dayIn(new Date(), zone)
    await addTime(
      user.id,
      [
        session(today, 600),
        session(today, 300, 'listening'),
        session(addDays(today, -1), 1200),
        session(addDays(today, -2), 1200),
        session(addDays(today, -4), 1200),
        session(addDays(today, -5), 1200),
        session(addDays(today, -6), 1200),
      ],
      zone,
    )
    await addTime(
      user.id,
      Array.from({ length: 7 }, () => session(addDays(today, -10), 14_400)),
    )
    await setGoalRow(user.id, addDays(today, -2), 30)
    await setGoalRow(user.id, today, 15)
    const stats = await ready(cookie)
    expect(stats).toMatchObject({
      today,
      goalMinutes: 15,
      todaySeconds: 900,
      todayMet: true,
      current: 1,
      best: 3,
      toKeepSeconds: 0,
      hasAny: true,
    })
    expect(stats.week.map((d) => [d.readingSeconds, d.listeningSeconds, d.goalMinutes, d.met])).toEqual([
      [1200, 0, 15, true],
      [1200, 0, 15, true],
      [1200, 0, 15, true],
      [0, 0, 15, false],
      [1200, 0, 30, false],
      [1200, 0, 30, false],
      [600, 300, 15, true],
    ])
    expect(stats.totals.week).toEqual({ reading: 600 + 5 * 1200, listening: 300 })
    expect(stats.totals.all).toEqual({ reading: 600 + 5 * 1200 + 86_400, listening: 300 })
    expect(await summaryState(get(cookie))).toEqual({
      state: 'ready',
      todaySeconds: 900,
      goalMinutes: 15,
      current: 1,
      todayMet: true,
    })
  })

  it('counts the month and the year by the zone’s calendar', async () => {
    const { user, cookie } = await signedIn()
    const zone = 'Asia/Kolkata'
    const today = dayIn(new Date(), zone)
    const monthStart = `${today.slice(0, 8)}01`
    const yearStart = `${today.slice(0, 4)}-01-01`
    await addTime(
      user.id,
      [
        session(today, 60),
        session(monthStart, 120),
        session(addDays(monthStart, -1), 240),
        session(yearStart, 480),
        session(addDays(yearStart, -1), 960),
      ],
      zone,
    )
    const stats = await ready(cookie)
    const inMonth = (day: string) => day.slice(0, 7) === today.slice(0, 7)
    const inYear = (day: string) => day.slice(0, 4) === today.slice(0, 4)
    const days: [string, number][] = [
      [today, 60],
      [monthStart, 120],
      [addDays(monthStart, -1), 240],
      [yearStart, 480],
      [addDays(yearStart, -1), 960],
    ]
    const sum = (keep: (day: string) => boolean) => days.filter(([d]) => keep(d)).reduce((n, [, s]) => n + s, 0)
    expect(stats.totals.month.reading).toBe(sum(inMonth))
    expect(stats.totals.year.reading).toBe(sum(inYear))
    expect(stats.totals.all.reading).toBe(sum(() => true))
  })

  it('lists finished books newest first with their titles and pages, leaving out a book that left the library', async () => {
    const { user, cookie } = await signedIn()
    const id = await privateBook(user.id, 'My notes')
    await raw`insert into finished_books (user_id, book_slug, finished_at) values (${user.id}, ${PRIDE}, now() - interval '1 day')`
    await raw`insert into finished_books (user_id, user_book_id) values (${user.id}, ${id})`
    await raw`insert into finished_books (user_id, book_slug) values (${user.id}, 'a-book-no-longer-here')`
    const stats = await ready(cookie)
    expect(stats.finished.map((f) => [f.book, f.title, f.href])).toEqual([
      [privateBookSlug(id), 'My notes', `/account/books/${id}`],
      [PRIDE, 'Pride and Prejudice', expect.stringMatching(new RegExp(`^/library/[^/]+/${PRIDE}$`))],
    ])
    expect(stats.hasAny).toBe(true)
    expect(stats.finishedThisYear).toBeGreaterThanOrEqual(1)
  })

  it('says unavailable when the database fails, logged as reading stats read', async () => {
    const { cookie } = await signedIn()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = (() => {
      throw new Error('the database went away')
    }) as unknown as Pool
    const real = getDb()
    try {
      vi.mocked(getDb).mockReturnValueOnce(real).mockReturnValueOnce(broken)
      expect(await statsState(get(cookie))).toEqual({ state: 'unavailable' })
      vi.mocked(getDb).mockReturnValueOnce(real).mockReturnValueOnce(broken)
      expect(await summaryState(get(cookie))).toEqual({ state: 'unavailable' })
      expect(errors.mock.calls.map((call) => String(call[0]))).toEqual([
        expect.stringMatching(/^\[reading stats read\] /),
        expect.stringMatching(/^\[reading stats read\] /),
      ])
    } finally {
      errors.mockRestore()
    }
  })
})

describe('POST /account/stats/goal', () => {
  it('refuses a signed-out request, bad bodies and a goal outside the choices', async () => {
    const { cookie } = await signedIn()
    const body = { minutes: 30, zone: 'UTC' }
    expect(await answer(await goal(null, body))).toEqual([401, { error: 'signed_out' }])
    expect(await answer(await goal(cookie, '{'))).toEqual([400, { error: 'invalid' }])
    expect(await answer(await goal(cookie, { minutes: 25, zone: 'UTC' }))).toEqual([400, { error: 'invalid' }])
    expect(await answer(await goal(cookie, { minutes: 30, zone: 'Mars/Olympus' }))).toEqual([400, { error: 'invalid' }])
    expect(await raw`select 1 from reading_goals`).toHaveLength(0)
  })

  it('sets the goal from today in the zone sent, keeps the zone, and replaces today’s goal', async () => {
    const { user, cookie } = await signedIn()
    const zone = 'Pacific/Kiritimati'
    const today = dayIn(new Date(), zone)
    expect(await answer(await goal(cookie, { minutes: 30, zone }))).toEqual([
      200,
      { goal: { minutes: 30, fromDay: today } },
    ])
    await goal(cookie, { minutes: 5, zone })
    expect(await raw`select from_day::text as day, minutes from reading_goals where user_id = ${user.id}`).toEqual([
      { day: today, minutes: 5 },
    ])
    expect((await raw`select time_zone from users where id = ${user.id}`)[0]?.time_zone).toBe(zone)
    const stats = await ready(cookie)
    expect(stats).toMatchObject({ today, goalMinutes: 5 })
    expect(stats.week[5]?.goalMinutes).toBe(15)
  })

  it('answers 500 failed when the database fails, logged without the body', async () => {
    const { cookie } = await signedIn()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = (() => {
      throw new Error('the database went away')
    }) as unknown as Pool
    const real = getDb()
    try {
      vi.mocked(getDb).mockReturnValueOnce(real).mockReturnValueOnce(broken)
      expect(await answer(await goal(cookie, { minutes: 90, zone: 'Europe/Istanbul' }))).toEqual([
        500,
        { error: 'failed' },
      ])
      const lines = errors.mock.calls.map((call) => String(call[0]))
      expect(lines).toEqual([expect.stringMatching(/^\[reading goal\] /)])
      expect(lines.join('\n')).not.toContain('Istanbul')
    } finally {
      errors.mockRestore()
    }
  })
})

describe('POST /account/stats/finished', () => {
  it('refuses a signed-out request and bad bodies', async () => {
    const { cookie } = await signedIn()
    const body = { book: PRIDE, finished: true }
    expect(await answer(await finished(null, body))).toEqual([401, { error: 'signed_out' }])
    expect(await answer(await finished(cookie, '{'))).toEqual([400, { error: 'invalid' }])
    expect(await answer(await finished(cookie, { book: PRIDE }))).toEqual([400, { error: 'invalid' }])
    expect(await raw`select 1 from finished_books`).toHaveLength(0)
  })

  it('marks a book finished once, and takes the mark off', async () => {
    const { user, cookie } = await signedIn()
    expect(await answer(await finished(cookie, { book: PRIDE, finished: true }))).toEqual([
      200,
      { book: PRIDE, finished: true, added: true },
    ])
    expect(await answer(await finished(cookie, { book: PRIDE, finished: true }))).toEqual([
      200,
      { book: PRIDE, finished: true, added: false },
    ])
    expect((await ready(cookie)).finished.map((f) => f.book)).toEqual([PRIDE])
    expect(await answer(await finished(cookie, { book: PRIDE, finished: false }))).toEqual([
      200,
      { book: PRIDE, finished: false, added: false },
    ])
    expect(await raw`select 1 from finished_books where user_id = ${user.id}`).toHaveLength(0)
    expect((await finished(cookie, { book: PRIDE, finished: false })).status).toBe(200)
  })

  it('is a 404 for an unknown book, one that left the library, and another reader’s private book', async () => {
    const ada = await signedIn()
    const bob = await signedIn()
    const id = await privateBook(ada.user.id)
    const notFound = [404, { error: 'not_found' }]
    expect(await answer(await finished(bob.cookie, { book: 'no-such-book', finished: true }))).toEqual(notFound)
    await raw`insert into finished_books (user_id, book_slug) values (${bob.user.id}, 'a-book-no-longer-here')`
    expect(await answer(await finished(bob.cookie, { book: 'a-book-no-longer-here', finished: false }))).toEqual(
      notFound,
    )
    expect(await answer(await finished(bob.cookie, { book: privateBookSlug(id), finished: true }))).toEqual(notFound)
    expect(await answer(await finished(bob.cookie, { book: privateBookSlug(id), finished: false }))).toEqual(notFound)
    expect(await answer(await finished(ada.cookie, { book: privateBookSlug(id), finished: true }))).toEqual([
      200,
      { book: privateBookSlug(id), finished: true, added: true },
    ])
  })

  it('deletes a private book’s mark with the book and keeps the time', async () => {
    const { user, cookie } = await signedIn()
    const id = await privateBook(user.id)
    await finished(cookie, { book: privateBookSlug(id), finished: true })
    await addTime(user.id, [session(dayIn(new Date(), 'UTC'), 600)])
    expect(await deleteBook(db(), user.id, id)).toBe(true)
    expect(await raw`select 1 from finished_books`).toHaveLength(0)
    expect(await raw`select seconds from reading_time where user_id = ${user.id}`).toEqual([{ seconds: 600 }])
  })

  it('answers 500 failed when the database fails, logged as finished book', async () => {
    const { cookie } = await signedIn()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = (() => {
      throw new Error('the database went away')
    }) as unknown as Pool
    const real = getDb()
    try {
      vi.mocked(getDb).mockReturnValueOnce(real).mockReturnValueOnce(broken)
      expect(await answer(await finished(cookie, { book: PRIDE, finished: true }))).toEqual([500, { error: 'failed' }])
      const lines = errors.mock.calls.map((call) => String(call[0]))
      expect(lines).toEqual([expect.stringMatching(/^\[finished book\] /)])
      expect(lines.join('\n')).not.toContain(PRIDE)
    } finally {
      errors.mockRestore()
    }
  })
})

describe('the account', () => {
  it('takes all of it when it is deleted', async () => {
    const { user, cookie } = await signedIn()
    await addTime(user.id, [session('2026-11-21', 60)], 'UTC')
    await finished(cookie, { book: PRIDE, finished: true })
    await setGoalRow(user.id, '2026-11-21', 30)
    await raw`delete from users where id = ${user.id}`
    expect(await raw`select 1 from reading_time`).toHaveLength(0)
    expect(await raw`select 1 from finished_books`).toHaveLength(0)
    expect(await raw`select 1 from reading_goals`).toHaveLength(0)
  })
})
