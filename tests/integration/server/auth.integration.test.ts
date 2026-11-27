import postgres, { type Sql } from 'postgres'
import { afterAll, beforeEach, describe, expect, vi } from 'vitest'
import { readerOf, sessionCookie, sessionCookieName, sessionForRequest, viewerForRequest } from '~/server/auth'
import { getConfig } from '~/server/config'
import { closeDb, getDb, isDatabaseConfigured } from '~/server/db'
import { hashToken, newSessionToken } from '~/server/security'
import { createSession } from '~/server/sessions'
import { createUser } from '~/server/users'
import { it, raw } from '../../support/server/db-test'

vi.mock('~/server/db.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/server/db.ts')>()
  return { ...actual, getDb: vi.fn(actual.getDb), isDatabaseConfigured: vi.fn(actual.isDatabaseConfigured) }
})

const cookieName = getConfig().cookieSecure ? '__Host-session' : 'session'

afterAll(async () => {
  await closeDb()
})
beforeEach(async () => {
  vi.mocked(getDb).mockClear()
})

const request = (cookie?: string) =>
  new Request(`${getConfig().appOrigin}/library`, { headers: cookie ? { cookie } : {} })

async function signedIn(role: 'admin' | 'member' = 'member') {
  const user = await createUser(getDb(), 'reader', '$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA', role)
  const token = newSessionToken()
  const hash = hashToken(token)
  await createSession(getDb(), { tokenHash: hash, userId: user.id, ip: null, userAgent: 'test' })
  vi.mocked(getDb).mockClear()
  return { user, hash, cookie: `${cookieName}=${token}` }
}

describe('the session cookie', () => {
  it('is __Host-session with Secure normally, and plain session over local HTTP (COOKIE_SECURE=false)', () => {
    const config = getConfig() as { cookieSecure: boolean }
    const secure = config.cookieSecure
    try {
      config.cookieSecure = true
      expect(sessionCookieName()).toBe('__Host-session')
      expect(sessionCookie('t', 60)).toBe('__Host-session=t; Path=/; Max-Age=60; HttpOnly; SameSite=Lax; Secure')
      config.cookieSecure = false
      expect(sessionCookieName()).toBe('session')
      expect(sessionCookie('t', 60.9)).toBe('session=t; Path=/; Max-Age=60; HttpOnly; SameSite=Lax')
      expect(sessionCookie('', -5)).toBe('session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax')
    } finally {
      config.cookieSecure = secure
    }
  })
})

describe('readerOf', () => {
  it('names the signed-in reader, nobody when signed out, and no database when there is none', async () => {
    const { user, cookie } = await signedIn()
    expect(await readerOf(request(cookie))).toEqual({ db: getDb(), userId: user.id })
    expect(await readerOf(request())).toEqual({ db: getDb(), userId: null })
    vi.mocked(isDatabaseConfigured).mockReturnValueOnce(false)
    expect(await readerOf(request(cookie))).toEqual({ db: null, userId: null })
  })
})

describe('sessionForRequest', () => {
  it('never queries the database for a request without a session cookie', async () => {
    expect(await sessionForRequest(request())).toBeNull()
    expect(await sessionForRequest(request('theme=dark; other=1'))).toBeNull()
    expect(await sessionForRequest(request(`${cookieName}=not-a-token`))).toBeNull()
    expect(await sessionForRequest(request(`${cookieName}=`))).toBeNull()
    expect(getDb).not.toHaveBeenCalled()
  })

  it('finds the signed-in user, once per request', async () => {
    const { user, cookie } = await signedIn('admin')
    const req = request(`theme=dark; ${cookie}`)
    expect(await sessionForRequest(req)).toMatchObject({ userId: user.id, username: 'reader', role: 'admin' })
    expect(await viewerForRequest(req)).toEqual({ username: 'reader', role: 'admin' })
    expect(getDb).toHaveBeenCalledTimes(1)
  })

  it('counts a session as signed out 30 days after sign-in, even if it was used a minute ago', async () => {
    const { hash, cookie } = await signedIn()
    const shift = async (by: string) => raw`
      update sessions set created_at = created_at - ${by}::interval, expires_at = expires_at - ${by}::interval,
        last_seen_at = now() - interval '1 minute'
      where token_hash = ${hash}`
    await shift('29 days 23 hours')
    expect(await sessionForRequest(request(cookie))).not.toBeNull()
    await shift('2 hours')
    expect(await sessionForRequest(request(cookie))).toBeNull()
    expect((await raw`select 1 from sessions`).count).toBe(0)
  })

  it('counts a session as signed out after 7 days without use', async () => {
    const { hash, cookie } = await signedIn()
    await raw`update sessions set last_seen_at = now() - interval '6 days 23 hours' where token_hash = ${hash}`
    expect(await sessionForRequest(request(cookie))).not.toBeNull()
    await raw`update sessions set last_seen_at = now() - interval '7 days 1 minute' where token_hash = ${hash}`
    expect(await sessionForRequest(request(cookie))).toBeNull()
  })

  it('counts a disabled user as signed out', async () => {
    const { user, cookie } = await signedIn()
    await raw`update users set disabled_at = now() where id = ${user.id}`
    expect(await viewerForRequest(request(cookie))).toBeNull()
  })

  it('writes last_seen_at at most every 10 minutes', async () => {
    const { hash, cookie } = await signedIn()
    const lastSeen = async () =>
      (await raw<{ t: Date }[]>`select last_seen_at as t from sessions where token_hash = ${hash}`)[0]?.t.getTime()
    await raw`update sessions set last_seen_at = now() - interval '9 minutes' where token_hash = ${hash}`
    const before = await lastSeen()
    await sessionForRequest(request(cookie))
    await sessionForRequest(request(cookie))
    expect(await lastSeen()).toBe(before)
    await raw`update sessions set last_seen_at = now() - interval '11 minutes' where token_hash = ${hash}`
    await sessionForRequest(request(cookie))
    expect(Date.now() - ((await lastSeen()) ?? 0)).toBeLessThan(60_000)
  })

  it('treats the visitor as signed out when the database fails, and logs the error redacted', async () => {
    const { cookie } = await signedIn()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = (() => {
      throw new Error('could not connect with sk-ant-api03-a-key-that-must-not-be-logged')
    }) as unknown as Sql
    vi.mocked(getDb).mockReturnValueOnce(broken)

    expect(await sessionForRequest(request(cookie))).toBeNull()
    expect(errors).toHaveBeenCalledTimes(1)
    const line = String(errors.mock.calls[0]?.[0])
    expect(line).toMatch(/^\[session lookup\] Error: could not connect/)
    expect(line).toContain('sk-ant-[redacted]')
    expect(line).not.toContain('a-key-that-must-not-be-logged')
  })

  it('stays signed out, without throwing, when the database cannot be reached at all', async () => {
    const { cookie } = await signedIn()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const unreachable = postgres('postgres://nobody@127.0.0.1:1/unreachable_test', {
      max: 1,
      connect_timeout: 2,
      onnotice: () => {},
    })
    vi.mocked(getDb).mockReturnValueOnce(unreachable)
    try {
      expect(await viewerForRequest(request(cookie))).toBeNull()
      expect(String(errors.mock.calls[0]?.[0])).toMatch(/^\[session lookup\]/)
    } finally {
      await unreachable.end({ timeout: 1 })
    }
  })
})
