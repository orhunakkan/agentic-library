import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleAccount, handleLogin, handleLogout } from '~/server/account-actions'
import { getConfig } from '~/server/config'
import { closeDb, getDb } from '~/server/db'
import { recordAttempt } from '~/server/login-attempts'
import { hashPassword, PARAMS, verifyPassword } from '~/server/passwords'
import { IP_LIMIT, USERNAME_LIMIT } from '~/server/rate-limit'
import { hashToken, newSessionToken } from '~/server/security'
import { createSession, findSession } from '~/server/sessions'
import { createUser, findUserByUsername } from '~/server/users'
import { DEFAULT_AFTER_SIGN_IN } from '~/shared/lib/safe-next'
import { databaseUrl, freshDatabase } from './testing/db'

const raw = postgres(databaseUrl, { max: 1, onnotice: () => {} })
const db = () => getDb()
const origin = getConfig().appOrigin
const secure = getConfig().cookieSecure
const cookieName = secure ? '__Host-session' : 'session'
const PASSWORD = 'a long enough passphrase for tests'
const IP = '198.51.100.7'
const CHEAP = { memory: 1024, passes: 1, parallelism: 1 }

beforeAll(freshDatabase)
afterAll(async () => {
  await raw.end()
  await closeDb()
})
beforeEach(async () => {
  await raw`truncate users, sessions, login_attempts, api_keys, audit_events restart identity cascade`
})

async function newUser(username = 'reader', password = PASSWORD) {
  return createUser(db(), username, await hashPassword(password, CHEAP), 'member')
}

function formPost(
  path: string,
  body: Record<string, string>,
  { cookie, ip = IP, from = origin }: { cookie?: string; ip?: string; from?: string } = {},
): Request {
  return new Request(`${origin}${path}`, {
    method: 'POST',
    headers: {
      origin: from,
      'content-type': 'application/x-www-form-urlencoded',
      'x-real-ip': ip,
      'user-agent': 'login.db.test',
      ...(cookie ? { cookie } : {}),
    },
    body: new URLSearchParams(body),
  })
}

const login = (body: Record<string, string>, options?: Parameters<typeof formPost>[2]) =>
  handleLogin(formPost('/login', body, options))

function tokenFrom(response: Response): string | undefined {
  const match = new RegExp(`^${cookieName}=([^;]*)`).exec(response.headers.get('set-cookie') ?? '')
  return match?.[1] || undefined
}

async function signedIn(username = 'reader') {
  const user = await newUser(username)
  const token = newSessionToken()
  await createSession(db(), { tokenHash: hashToken(token), userId: user.id, ip: IP, userAgent: 'test' })
  return { user, token, cookie: `${cookieName}=${token}` }
}

const sessionCount = async () => (await raw`select 1 from sessions`).count

describe('handleLogin', () => {
  it('signs in with the right password and sets a session cookie with the right flags', async () => {
    const user = await newUser()
    const response = await login({ username: 'Reader', password: PASSWORD })
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(DEFAULT_AFTER_SIGN_IN)
    expect(response.headers.get('cache-control')).toBe('private, no-store')

    const cookie = response.headers.get('set-cookie') ?? ''
    const parts = cookie.split('; ')
    expect(parts).toEqual(expect.arrayContaining(['Path=/', 'HttpOnly', 'SameSite=Lax']))
    expect(parts.includes('Secure')).toBe(secure)
    const maxAge = Number(parts.find((p) => p.startsWith('Max-Age='))?.slice(8))
    expect(maxAge).toBeGreaterThan(30 * 24 * 60 * 60 - 60)
    expect(maxAge).toBeLessThanOrEqual(30 * 24 * 60 * 60)

    const token = tokenFrom(response)
    expect(token).toBeDefined()
    expect(await findSession(db(), hashToken(token ?? ''))).toMatchObject({ userId: user.id, username: 'reader' })
    const [row] = await raw<{ ip: string; ua: string }[]>`select host(ip) as ip, user_agent as ua from sessions`
    expect(row).toEqual({ ip: IP, ua: 'login.db.test' })
    const events = await raw<{ event: string }[]>`select event from audit_events`
    expect(events.map((e) => e.event)).toEqual(['login.succeeded'])
  })

  it('replaces the session the browser already had', async () => {
    const { token, cookie } = await signedIn()
    const response = await login({ username: 'reader', password: PASSWORD }, { cookie })
    expect(tokenFrom(response)).not.toBe(token)
    expect(await findSession(db(), hashToken(token))).toBeNull()
    expect(await sessionCount()).toBe(1)
  })

  it('upgrades a hash made with weaker parameters', async () => {
    await newUser()
    const cheap = (await findUserByUsername(db(), 'reader'))?.passwordHash ?? ''
    expect(cheap).toContain(`m=${CHEAP.memory},`)
    await login({ username: 'reader', password: PASSWORD })
    const stored = (await findUserByUsername(db(), 'reader'))?.passwordHash ?? ''
    expect(stored).toContain(`m=${PARAMS.memory},t=${PARAMS.passes},p=${PARAMS.parallelism}`)
    expect(await verifyPassword(PASSWORD, stored)).toBe(true)
  })

  it('gives a wrong password, an unknown username and a malformed one the same answer', async () => {
    await newUser()
    const answers = await Promise.all([
      login({ username: 'reader', password: 'not the password at all' }),
      login({ username: 'nobody-here', password: PASSWORD }),
      login({ username: 'x', password: PASSWORD }),
      login({ username: 'reader', password: 'p'.repeat(2000) }),
    ])
    const shapes = answers.map((r) => [r.status, r.headers.get('location'), r.headers.get('set-cookie')])
    expect(shapes).toEqual(Array(4).fill([303, '/login?error=invalid', null]))
    expect(await sessionCount()).toBe(0)
    const reasons = await raw<{ reason: string }[]>`
      select detail->>'reason' as reason from audit_events where event = 'login.failed' order by reason`
    expect(reasons.map((r) => r.reason)).toEqual(['malformed', 'malformed', 'unknown user', 'wrong password'])
  })

  it('refuses a disabled account with the same answer, even with the right password', async () => {
    const user = await newUser()
    await raw`update users set disabled_at = now() where id = ${user.id}`
    const response = await login({ username: 'reader', password: PASSWORD })
    expect(response.headers.get('location')).toBe('/login?error=invalid')
    expect(await sessionCount()).toBe(0)
  })

  it('locks the username after the configured number of failures, even for the right password', async () => {
    await newUser()
    for (let i = 0; i < USERNAME_LIMIT.max; i++) {
      await login({ username: 'reader', password: `wrong password number ${i}` }, { ip: `203.0.113.${i + 1}` })
    }
    const locked = await login({ username: 'reader', password: PASSWORD }, { ip: '203.0.113.200' })
    expect(locked.headers.get('location')).toBe('/login?error=invalid')
    expect(locked.headers.get('set-cookie')).toBeNull()
    const lockEvents = await raw<{ reason: string }[]>`
      select detail->>'reason' as reason from audit_events where event = 'login.locked' order by id`
    expect(lockEvents.map((e) => e.reason)).toEqual(['lock started', 'username locked'])
    const attempts = await raw`select 1 from login_attempts where username = 'reader'`
    expect(attempts.count).toBe(USERNAME_LIMIT.max)
  })

  it('does not lock after one failure fewer than the limit', async () => {
    await newUser()
    for (let i = 0; i < USERNAME_LIMIT.max - 1; i++) await login({ username: 'reader', password: `wrong ${i} xxxxxxx` })
    expect(tokenFrom(await login({ username: 'reader', password: PASSWORD }))).toBeDefined()
  })

  it('blocks an IP after the configured number of failures, whatever the username', async () => {
    await newUser()
    for (let i = 0; i < IP_LIMIT.max; i++) {
      await recordAttempt(db(), { username: `someone-${i}`, ip: IP, succeeded: false })
    }
    const blocked = await login({ username: 'reader', password: PASSWORD })
    expect(blocked.headers.get('location')).toBe('/login?error=invalid')
    expect(blocked.headers.get('set-cookie')).toBeNull()
    const [event] = await raw<{ reason: string }[]>`
      select detail->>'reason' as reason from audit_events where event = 'login.locked'`
    expect(event?.reason).toBe('ip blocked')
    expect(tokenFrom(await login({ username: 'reader', password: PASSWORD }, { ip: '192.0.2.50' }))).toBeDefined()
  })

  it('follows a same-site next, and sends anything else to the library', async () => {
    await newUser()
    const to = async (next: string) =>
      (await login({ username: 'reader', password: PASSWORD, next })).headers.get('location')
    expect(await to('/account/books?tab=1#top')).toBe('/account/books?tab=1#top')
    expect(await to('https://evil.example/')).toBe(DEFAULT_AFTER_SIGN_IN)
    expect(await to('//evil.example/')).toBe(DEFAULT_AFTER_SIGN_IN)
    expect(await to('/\\evil.example')).toBe(DEFAULT_AFTER_SIGN_IN)
    expect(await to('javascript:alert(1)')).toBe(DEFAULT_AFTER_SIGN_IN)
  })

  it('keeps a safe next on the error redirect, and drops an unsafe one', async () => {
    await newUser()
    const failed = await login({ username: 'reader', password: 'not the password at all', next: '/account' })
    expect(failed.headers.get('location')).toBe('/login?error=invalid&next=%2Faccount')
    const unsafe = await login({ username: 'reader', password: 'not the password at all', next: '//evil.example' })
    expect(unsafe.headers.get('location')).toBe('/login?error=invalid')
  })

  it('refuses a post from another origin before reading it', async () => {
    await newUser()
    const response = await login({ username: 'reader', password: PASSWORD }, { from: 'https://evil.example' })
    expect(response.status).toBe(403)
    expect((await raw`select 1 from login_attempts`).count).toBe(0)
  })

  it('answers a body that is not a form with the invalid error', async () => {
    const request = new Request(`${origin}/login`, {
      method: 'POST',
      headers: { origin, 'content-type': 'multipart/form-data; boundary=x' },
      body: 'not multipart',
    })
    expect((await handleLogin(request)).headers.get('location')).toBe('/login?error=invalid')
  })

  it('sweeps activity older than a year after a sign-in, and keeps the rest', async () => {
    await newUser()
    await raw`
      insert into audit_events (event, at, detail)
      values ('logout', now() - interval '366 days', '{"age": "old"}'), ('logout', now() - interval '364 days', '{"age": "kept"}')`
    expect((await login({ username: 'reader', password: PASSWORD })).status).toBe(303)
    await vi.waitFor(async () =>
      expect(
        (await raw<{ age: string }[]>`select detail->>'age' as age from audit_events where event = 'logout'`).map(
          (r) => r.age,
        ),
      ).toEqual(['kept']),
    )
  })
})

describe('a database failure', () => {
  it('answers a sign-in with unavailable, logged without the password', async () => {
    await newUser()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await raw`alter table login_attempts rename to login_attempts_away`
    try {
      const response = await login({ username: 'reader', password: PASSWORD })
      expect([response.status, response.headers.get('location')]).toEqual([303, '/login?error=unavailable'])
      expect(response.headers.get('set-cookie')).toBeNull()
      const lines = error.mock.calls.map((call) => String(call[0]))
      expect(lines).toEqual([expect.stringMatching(/^\[sign-in\] /)])
      expect(lines.join('\n')).not.toContain(PASSWORD)
    } finally {
      await raw`alter table login_attempts_away rename to login_attempts`
      error.mockRestore()
    }
  })

  it('still clears the cookie on sign-out, and logs it', async () => {
    const { cookie } = await signedIn()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await raw`alter table sessions rename to sessions_away`
    try {
      const response = await handleLogout(formPost('/logout', {}, { cookie }))
      expect([response.status, response.headers.get('location')]).toEqual([303, DEFAULT_AFTER_SIGN_IN])
      expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
      expect(error.mock.calls.map((call) => String(call[0]))).toEqual([
        expect.stringMatching(/^\[session lookup\] /),
        expect.stringMatching(/^\[sign-out\] /),
      ])
    } finally {
      await raw`alter table sessions_away rename to sessions`
      error.mockRestore()
    }
  })
})

describe('the sweeps after a sign-in', () => {
  it('log a failed sweep without failing the sign-in', async () => {
    await newUser()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await raw`alter table signup_tokens rename to signup_tokens_away`
    try {
      expect((await login({ username: 'reader', password: PASSWORD })).status).toBe(303)
      await vi.waitFor(() => expect(String(error.mock.calls[0]?.[0])).toMatch(/^\[sweep\] /))
    } finally {
      await raw`alter table signup_tokens_away rename to signup_tokens`
      error.mockRestore()
    }
  })
})

describe('handleLogout', () => {
  it('deletes the session row, clears the cookie and goes to the library', async () => {
    const { user, token, cookie } = await signedIn()
    const response = await handleLogout(formPost('/logout', {}, { cookie }))
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(DEFAULT_AFTER_SIGN_IN)
    const cleared = response.headers.get('set-cookie') ?? ''
    expect(cleared).toMatch(new RegExp(`^${cookieName}=;`))
    expect(cleared).toContain('Max-Age=0')
    expect(await findSession(db(), hashToken(token))).toBeNull()
    const events = await raw<{ event: string; user_id: string }[]>`select event, user_id from audit_events`
    expect(events).toEqual([{ event: 'logout', user_id: String(user.id) }])
  })

  it('ends only the session it was sent with', async () => {
    const mine = await signedIn()
    const other = newSessionToken()
    await createSession(db(), { tokenHash: hashToken(other), userId: mine.user.id, ip: null, userAgent: 'other' })
    await handleLogout(formPost('/logout', {}, { cookie: mine.cookie }))
    expect(await findSession(db(), hashToken(other))).not.toBeNull()
  })

  it('clears the cookie even without a session', async () => {
    const response = await handleLogout(formPost('/logout', {}))
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
    expect((await raw`select 1 from audit_events`).count).toBe(0)
  })

  it('refuses another origin and leaves the session alone', async () => {
    const { token, cookie } = await signedIn()
    const response = await handleLogout(formPost('/logout', {}, { cookie, from: 'https://evil.example' }))
    expect(response.status).toBe(403)
    expect(await findSession(db(), hashToken(token))).not.toBeNull()
  })
})

describe('handleAccount', () => {
  const account = (body: Record<string, string>, cookie?: string) =>
    handleAccount(formPost('/account', body, cookie ? { cookie } : {}))

  it('sends a visitor without a session to sign-in, coming back to /account', async () => {
    const response = await account({ intent: 'revoke-others' })
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/login?next=%2Faccount')
  })

  it('treats an expired or forged cookie as no session', async () => {
    const { token, cookie } = await signedIn()
    await raw`update sessions set expires_at = now() - interval '1 second' where token_hash = ${hashToken(token)}`
    expect((await account({ intent: 'revoke-others' }, cookie)).headers.get('location')).toBe('/login?next=%2Faccount')
    const forged = `${cookieName}=${newSessionToken()}`
    expect((await account({ intent: 'revoke-others' }, forged)).headers.get('location')).toBe('/login?next=%2Faccount')
  })

  it('refuses another origin', async () => {
    const { cookie } = await signedIn()
    expect((await handleAccount(formPost('/account', {}, { cookie, from: 'https://evil.example' }))).status).toBe(403)
  })

  it('signs out every other session and keeps this one', async () => {
    const { user, token, cookie } = await signedIn()
    const other = newSessionToken()
    await createSession(db(), { tokenHash: hashToken(other), userId: user.id, ip: null, userAgent: 'other' })
    const response = await account({ intent: 'revoke-others' }, cookie)
    expect(response.headers.get('location')).toBe('/account?status=signed-out-others#sessions')
    expect(await findSession(db(), hashToken(token))).not.toBeNull()
    expect(await findSession(db(), hashToken(other))).toBeNull()
  })

  it('changes the password only with the current one, and ends the other sessions', async () => {
    const { user, token, cookie } = await signedIn()
    const other = newSessionToken()
    await createSession(db(), { tokenHash: hashToken(other), userId: user.id, ip: null, userAgent: 'other' })
    const next = 'an entirely new passphrase here'
    const change = (fields: Record<string, string>) => account({ intent: 'change-password', ...fields }, cookie)

    expect((await change({ current: PASSWORD, password: next, confirm: `${next}!` })).headers.get('location')).toBe(
      '/account?error=mismatch#password',
    )
    expect((await change({ current: PASSWORD, password: 'short', confirm: 'short' })).headers.get('location')).toBe(
      '/account?error=policy&reason=short#password',
    )
    expect(
      (await change({ current: 'not the current one at all', password: next, confirm: next })).headers.get('location'),
    ).toBe('/account?error=current#password')
    expect(await verifyPassword(PASSWORD, (await findUserByUsername(db(), 'reader'))?.passwordHash ?? '')).toBe(true)

    expect((await change({ current: PASSWORD, password: next, confirm: next })).headers.get('location')).toBe(
      '/account?status=password-changed',
    )
    expect(await verifyPassword(next, (await findUserByUsername(db(), 'reader'))?.passwordHash ?? '')).toBe(true)
    expect(await findSession(db(), hashToken(token))).not.toBeNull()
    expect(await findSession(db(), hashToken(other))).toBeNull()
  })

  it('answers an unknown intent with the invalid error', async () => {
    const { cookie } = await signedIn()
    expect((await account({ intent: 'delete-everything' }, cookie)).headers.get('location')).toBe(
      '/account?error=invalid',
    )
  })
})
