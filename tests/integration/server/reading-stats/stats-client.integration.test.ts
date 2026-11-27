import { afterAll, describe, expect, vi } from 'vitest'
import { it, raw } from '../../../support/server/db-test'
import { testUser } from '../../../support/server/users'

vi.mock('~/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/server/db')>()
  return { ...actual, getDb: vi.fn(actual.getDb) }
})

import { saveGoal, setFinished } from '~/client/features/reading-stats/stats-client'
import { getConfig } from '~/server/config'
import { closeDb, getDb, type Pool } from '~/server/db'
import { handleFinished, handleGoal } from '~/server/reading-stats/actions'
import { statsState } from '~/server/reading-stats/read'
import { hashToken, newSessionToken } from '~/server/security'
import { createSession } from '~/server/sessions'
import { dayIn } from '~/shared/reading-stats/days'

const db = () => getDb()
const origin = getConfig().appOrigin
const cookieName = getConfig().cookieSecure ? '__Host-session' : 'session'
const PRIDE = 'pride-and-prejudice'

afterAll(async () => {
  await closeDb()
})

let users = 0

/** Signs a reader in, and routes the client's fetch to the real reading-stats handlers with their cookie. */
async function signedIn(signedOut = false) {
  const user = await testUser(db(), `reader-${++users}`, '$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA', 'member')
  const token = newSessionToken()
  await createSession(db(), { tokenHash: hashToken(token), userId: user.id, ip: null, userAgent: 'test' })
  const cookie = `${cookieName}=${token}`
  vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
    const headers = new Headers(init.headers)
    headers.set('origin', origin)
    if (!signedOut) headers.set('cookie', cookie)
    const request = new Request(`${origin}${path}`, { ...init, headers })
    if (path === '/account/stats/goal') return handleGoal(request)
    if (path === '/account/stats/finished') return handleFinished(request)
    throw new Error(`no reading-stats route at ${path}`)
  })
  const state = async () => {
    const found = await statsState(new Request(`${origin}/account/stats`, { headers: { cookie } }))
    if (found.state !== 'ready') throw new Error(found.state)
    return found
  }
  return { user, state }
}

/** Breaks the database for the next request: the session lookup gets the real one, the handler a broken one. */
function breakNextRequest() {
  const broken = (() => {
    throw new Error('the database went away')
  }) as unknown as Pool
  vi.mocked(getDb).mockReturnValueOnce(getDb()).mockReturnValueOnce(broken)
}

describe('the stats client against the reading-stats endpoints', () => {
  it('sets a goal from today in the zone sent, reading back what the server stored', async () => {
    const { state } = await signedIn()
    const zone = 'Pacific/Kiritimati'
    const today = dayIn(new Date(), zone)
    expect(await saveGoal(30, zone)).toEqual({ ok: true, value: { minutes: 30, fromDay: today } })
    expect(await state()).toMatchObject({ today, goalMinutes: 30 })
  })

  it('marks a book finished once, and takes the mark off', async () => {
    const { state } = await signedIn()
    expect(await setFinished(PRIDE, true)).toEqual({ ok: true, value: { book: PRIDE, finished: true, added: true } })
    expect(await setFinished(PRIDE, true)).toEqual({ ok: true, value: { book: PRIDE, finished: true, added: false } })
    expect((await state()).finished.map((finished) => finished.book)).toEqual([PRIDE])
    expect(await setFinished(PRIDE, false)).toEqual({ ok: true, value: { book: PRIDE, finished: false, added: false } })
    expect((await state()).finished).toEqual([])
  })

  it('reads each refusal the server sends as its problem', async () => {
    await signedIn()
    expect(await saveGoal(25, 'UTC')).toEqual({ ok: false, problem: 'invalid' })
    expect(await saveGoal(30, 'Mars/Olympus')).toEqual({ ok: false, problem: 'invalid' })
    expect(await setFinished('Not A Slug', true)).toEqual({ ok: false, problem: 'invalid' })
    expect(await setFinished('no-such-book', true)).toEqual({ ok: false, problem: 'not_found' })
    expect(await raw`select 1 from reading_goals union all select 1 from finished_books`).toHaveLength(0)
  })

  it('reads a signed-out answer as signed out', async () => {
    await signedIn(true)
    expect(await saveGoal(30, 'UTC')).toEqual({ ok: false, problem: 'signed_out' })
    expect(await setFinished(PRIDE, true)).toEqual({ ok: false, problem: 'signed_out' })
  })

  it('reads the server failing as failed', async () => {
    await signedIn()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    breakNextRequest()
    expect(await saveGoal(30, 'UTC')).toEqual({ ok: false, problem: 'failed' })
    breakNextRequest()
    expect(await setFinished(PRIDE, true)).toEqual({ ok: false, problem: 'failed' })
  })
})
