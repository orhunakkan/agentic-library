import { execFileSync } from 'node:child_process'
import type { Sql } from 'postgres'
import { afterAll, describe, expect, vi } from 'vitest'
import { handleAccount, handleApiKeys, handleLogin } from '~/server/account-actions'
import { readAccount } from '~/server/account-data/store'
import { handleNewUser, handleUserChange } from '~/server/admin/actions'
import { deleteAccount, setDisabledGuarded } from '~/server/admin/store'
import { handleAsk } from '~/server/ask/ask'
import { handleMe, sessionForRequest, viewerForRequest } from '~/server/auth'
import { getConfig } from '~/server/config'
import { closeDb, getDb, isDatabaseConfigured } from '~/server/db'
import { createToken, resetPassword } from '~/server/email/store'
import { recordAttempt } from '~/server/login-attempts'
import { handleAddOptions } from '~/server/passkeys/actions'
import { hashPassword } from '~/server/passwords'
import { IP_LIMIT, RESET_ACCOUNT_LIMIT, USERNAME_LIMIT } from '~/server/rate-limit'
import { hashToken, newAccessToken, newSessionToken } from '~/server/security'
import { createSession } from '~/server/sessions'
import { handleShelfBook, handleShelfChange, handleShelfCreate } from '~/server/shelves/actions'
import { checkSignIn, finishSignIn } from '~/server/sign-in'
import { createUser, type Role } from '~/server/users'
import { databaseUrl } from '../testing/db'
import { it, raw } from '../testing/db-test'
import { handleTokenCreate, handleTokenList, handleTokenRevoke } from './actions'
import { endUserAccess, findAccessToken, MAX_ACCESS_TOKENS } from './store'

vi.mock('../db.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db.ts')>()
  return { ...actual, getDb: vi.fn(actual.getDb), isDatabaseConfigured: vi.fn(actual.isDatabaseConfigured) }
})

const origin = getConfig().appOrigin
const cookieName = getConfig().cookieSecure ? '__Host-session' : 'session'
const PASSWORD = 'a long enough passphrase for tests'
const IP = '198.51.100.9'
const CHEAP = { memory: 1024, passes: 1, parallelism: 1 }
const UNKNOWN_ID = '0b6d5c3e-9f1a-4c2b-8d7e-6a5b4c3d2e1f'

afterAll(async () => {
  await closeDb()
})

interface Options {
  method?: string
  body?: unknown
  bearer?: string
  authorization?: string
  cookie?: string
  from?: string | null
  ip?: string
  contentType?: string
  form?: Record<string, string>
}

function req(path: string, o: Options = {}): Request {
  const headers: Record<string, string> = { 'x-real-ip': o.ip ?? IP, 'user-agent': 'access-tokens.db.test' }
  if (o.from !== null && o.from !== undefined) headers.origin = o.from
  if (o.bearer) headers.authorization = `Bearer ${o.bearer}`
  if (o.authorization !== undefined) headers.authorization = o.authorization
  if (o.cookie) headers.cookie = o.cookie
  const method = o.method ?? 'POST'
  if (o.form) {
    headers['content-type'] = 'application/x-www-form-urlencoded'
    return new Request(`${origin}${path}`, { method, headers, body: new URLSearchParams(o.form) })
  }
  if (method === 'GET') return new Request(`${origin}${path}`, { method, headers })
  headers['content-type'] = o.contentType ?? 'application/json'
  return new Request(`${origin}${path}`, {
    method,
    headers,
    body: typeof o.body === 'string' ? o.body : JSON.stringify(o.body ?? {}),
  })
}

async function newUser(username = 'ann', role: Role = 'member') {
  return createUser(getDb(), username, await hashPassword(PASSWORD, CHEAP), role)
}

async function withSession(userId: number) {
  const token = newSessionToken()
  await createSession(getDb(), { tokenHash: hashToken(token), userId, ip: IP, userAgent: 'test' })
  return { cookie: `${cookieName}=${token}`, hash: hashToken(token) }
}

const create = (body: unknown, o: Options = {}) => handleTokenCreate(req('/api/tokens', { body, ...o }))
const me = (o: Options = {}) => handleMe(req('/api/me', { method: 'GET', ...o }))
const list = (o: Options = {}) => handleTokenList(req('/api/tokens', { method: 'GET', ...o }))
const revoke = (id: string, o: Options = {}) =>
  handleTokenRevoke(req(`/api/tokens/${id}`, { body: { intent: 'revoke' }, ...o }), id)

interface Made {
  token: string
  tokenType: string
  expiresAt: string
  id: string
  name: string
}

async function made(username = 'ann', extra: object = {}): Promise<Made> {
  const response = await create({ username, password: PASSWORD, expiresInDays: 1, ...extra })
  expect(response.status).toBe(201)
  return response.json()
}

const tokenRows = async () => (await raw`select id from access_tokens`).count
const events = async (event: string) =>
  (
    await raw<{ detail: Record<string, unknown> }[]>`select detail from audit_events where event = ${event} order by id`
  ).map((r) => r.detail)

describe('the shared sign-in check', () => {
  it('adds via to the events only when given, so the sign-in form writes what it always has', async () => {
    const ann = await newUser()
    const db = getDb()
    expect(await checkSignIn(db, { username: 'ann', password: 'the wrong password entirely', ip: IP })).toEqual({
      ok: false,
      refusal: 'invalid',
    })
    await checkSignIn(db, { username: 'ann', password: 'the wrong password entirely', ip: IP, via: 'token' })
    expect(await events('login.failed')).toEqual([
      { username: 'ann', reason: 'wrong password' },
      { username: 'ann', reason: 'wrong password', via: 'token' },
    ])
    const check = await checkSignIn(db, { username: 'ann', password: PASSWORD, ip: IP })
    if (!check.ok) throw new Error('expected a sign-in')
    expect(check.user.id).toBe(ann.id)
    await finishSignIn(db, { attempt: check.attempt, userId: ann.id, ip: IP })
    expect(await events('login.succeeded')).toEqual([{}])
    expect((await raw`select 1 from login_attempts where succeeded`).count).toBe(1)
  })
})

describe('making a token', () => {
  it('answers 201 with the token once, stores only its hash, and the token signs in', async () => {
    const ann = await newUser()
    const response = await create({ username: 'Ann', password: PASSWORD, name: ' API tests ' }, { from: null })
    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    const body = (await response.json()) as Made
    expect(Object.keys(body)).toEqual(['token', 'tokenType', 'expiresAt', 'id', 'name'])
    expect(body.token).toMatch(/^folio_at_[A-Za-z0-9_-]{43}$/)
    expect(body.tokenType).toBe('Bearer')
    expect(body.name).toBe('API tests')

    const [row] = await raw<{ token_hash: Buffer; user_id: string; ip: string; user_agent: string }[]>`
      select token_hash, user_id, host(ip) as ip, user_agent from access_tokens`
    expect(row?.token_hash.equals(hashToken(body.token))).toBe(true)
    expect(Number(row?.user_id)).toBe(ann.id)
    expect(row?.ip).toBe(IP)
    expect(row?.user_agent).toBe('access-tokens.db.test')
    const dump = JSON.stringify(await raw`select * from access_tokens`)
    expect(dump).not.toContain(body.token.slice(9))

    const who = await me({ bearer: body.token })
    expect(who.status).toBe(200)
    expect(await who.json()).toEqual({ username: 'ann', role: 'member', via: 'token' })
  })

  it('lasts expiresInDays, 30 without it', async () => {
    await newUser()
    const days = async (extra: object) => {
      const { expiresAt } = await made('ann', extra)
      return Math.round((Date.parse(expiresAt) - Date.now()) / 86_400_000)
    }
    expect(await days({ expiresInDays: 3 })).toBe(3)
    expect(await days({ expiresInDays: undefined })).toBe(30)
  })

  it('stops at 10 live tokens with 409 quota; an ended one doesn’t count', async () => {
    const ann = await newUser()
    await raw`
      insert into access_tokens (user_id, token_hash, name, expires_at)
      select ${ann.id}, sha256(g::text::bytea), 'filler', now() + interval '1 day'
      from generate_series(1, ${MAX_ACCESS_TOKENS}) g`
    const full = await create({ username: 'ann', password: PASSWORD })
    expect(full.status).toBe(409)
    expect(await full.json()).toEqual({ error: 'quota', max: 10 })
    expect((await raw`select 1 from login_attempts where not succeeded`).count).toBe(0)

    await raw`
      update access_tokens set created_at = now() - interval '2 days', expires_at = now() - interval '1 day'
      where id = (select id from access_tokens limit 1)`
    expect((await create({ username: 'ann', password: PASSWORD })).status).toBe(201)
    expect(await tokenRows()).toBe(10)
  })

  it('refuses a wrong password, an unknown, disabled or malformed user and a locked name with one answer', async () => {
    const ann = await newUser()
    const disabled = await newUser('bob')
    await raw`update users set disabled_at = now() where id = ${disabled.id}`
    await newUser('cat')
    for (let i = 0; i < USERNAME_LIMIT.max; i++)
      await recordAttempt(getDb(), { username: 'cat', ip: '203.0.113.1', succeeded: false })

    const bodies = []
    for (const [username, password] of [
      ['ann', 'the wrong password entirely'],
      ['nobody', PASSWORD],
      ['bob', PASSWORD],
      ['no spaces allowed', PASSWORD],
      ['cat', PASSWORD],
    ]) {
      const response = await create({ username, password })
      expect(response.status, username).toBe(401)
      expect(response.headers.get('www-authenticate'), username).toBeNull()
      bodies.push(await response.json())
    }
    expect(bodies).toEqual(Array(5).fill({ error: 'invalid_credentials' }))
    expect(await tokenRows()).toBe(0)
    const failed = await events('login.failed')
    expect(failed.map((d) => d.reason)).toEqual(['wrong password', 'unknown user', 'disabled', 'malformed'])
    expect(failed.every((d) => d.via === 'token')).toBe(true)
    expect(await events('login.locked')).toEqual([{ username: 'cat', reason: 'username locked', via: 'token' }])
    void ann
  })

  it('counts towards the username’s lock for the sign-in form too', async () => {
    await newUser()
    for (let i = 0; i < USERNAME_LIMIT.max; i++)
      expect((await create({ username: 'ann', password: 'the wrong password entirely' })).status).toBe(401)
    expect((await create({ username: 'ann', password: PASSWORD })).status).toBe(401)
    const form = await handleLogin(req('/login', { form: { username: 'ann', password: PASSWORD }, from: origin }))
    expect(form.headers.get('location')).toContain('error=invalid')
  })

  it('answers 429 limited from a blocked IP, before the password is checked', async () => {
    await newUser()
    for (let i = 0; i < IP_LIMIT.max; i++) await recordAttempt(getDb(), { username: `x${i}`, ip: IP, succeeded: false })
    const response = await create({ username: 'ann', password: PASSWORD })
    expect(response.status).toBe(429)
    expect(await response.json()).toEqual({ error: 'limited' })
    expect(await events('login.locked')).toEqual([{ username: 'ann', reason: 'ip blocked', via: 'token' }])
  })

  it('needs no Origin but refuses a foreign one, and a cookie doesn’t stand in for the password', async () => {
    const ann = await newUser()
    const { cookie } = await withSession(ann.id)
    expect((await create({ username: 'ann', password: PASSWORD }, { from: 'https://evil.example' })).status).toBe(403)
    expect((await create({ username: 'ann', password: PASSWORD }, { from: origin })).status).toBe(201)
    expect((await create({ username: 'ann', password: 'wrong wrong wrong wrong' }, { cookie })).status).toBe(401)
  })

  it('refuses a body that isn’t JSON, is too big or isn’t the right shape', async () => {
    await newUser()
    const status = async (o: Options) => {
      const response = await handleTokenCreate(req('/api/tokens', o))
      return [response.status, ((await response.json()) as { error: string }).error]
    }
    expect(await status({ body: 'username=ann', contentType: 'application/x-www-form-urlencoded' })).toEqual([
      415,
      'invalid',
    ])
    expect(await status({ body: { username: 'ann', password: 'x'.repeat(9000) } })).toEqual([413, 'invalid'])
    expect(await status({ body: '{not json' })).toEqual([400, 'invalid'])
    expect(await status({ body: { username: 'ann', password: PASSWORD, scope: 'all' } })).toEqual([400, 'invalid'])
    expect(await status({ body: { username: 'ann', password: PASSWORD, expiresInDays: 31 } })).toEqual([400, 'invalid'])
    expect((await raw`select 1 from login_attempts`).count).toBe(0)
  })

  it('writes token.created and login.succeeded with via token, and no audit row holds the token or its hash', async () => {
    const ann = await newUser()
    const token = await made('ann', { name: 'CI' })
    await me({ bearer: token.token })
    await revoke('current', { bearer: token.token })
    expect(await events('login.succeeded')).toEqual([{ via: 'token' }])
    expect(await events('token.created')).toEqual([{ id: token.id, name: 'CI', expiresAt: token.expiresAt }])
    expect(await events('token.revoked')).toEqual([{ id: token.id, via: 'self' }])
    const all = JSON.stringify(await raw`select * from audit_events`)
    expect(all).not.toContain('folio_at_')
    expect(all).not.toContain(token.token.slice(9))
    expect(all).not.toContain(hashToken(token.token).toString('hex'))
    expect(all).not.toContain(PASSWORD)
    void ann
  })
})

describe('using a token', () => {
  it('works on GET /api/me and the shelves endpoints', async () => {
    await newUser()
    const { token } = await made()
    const shelf = await handleShelfCreate(req('/account/shelves/new', { body: { name: 'To read' }, bearer: token }))
    expect(shelf.status).toBe(201)
    const { id } = ((await shelf.json()) as { shelf: { id: string } }).shelf
    const renamed = await handleShelfChange(
      req(`/account/shelves/${id}`, { body: { name: 'Later' }, bearer: token }),
      id,
    )
    expect(renamed.status).toBe(200)
    const book = await handleShelfBook(
      req(`/account/shelves/${id}/books`, { body: { book: 'pride-and-prejudice', on: true }, bearer: token }),
      id,
    )
    expect(book.status).toBe(200)
    const deleted = await handleShelfChange(
      req(`/account/shelves/${id}`, { body: { intent: 'delete' }, bearer: token }),
      id,
    )
    expect(await deleted.json()).toEqual({ deleted: true })
  })

  it('ends an expired, an idle and a disabled user’s token: 401 invalid_token, and the row is deleted', async () => {
    const ann = await newUser()
    const expired = await made()
    const idle = await made()
    await raw`update access_tokens set created_at = now() - interval '2 days', expires_at = now() - interval '1 day'
      where id = ${expired.id}`
    await raw`update access_tokens set created_at = now() - interval '8 days', last_used_at = now() - interval '8 days'
      where id = ${idle.id}`
    for (const { token } of [expired, idle]) {
      const response = await me({ bearer: token })
      expect(response.status).toBe(401)
      expect(response.headers.get('www-authenticate')).toBe('Bearer error="invalid_token"')
      expect(await response.json()).toEqual({ error: 'signed_out' })
    }
    expect(await tokenRows()).toBe(0)

    const live = await made()
    await raw`update users set disabled_at = now() where id = ${ann.id}`
    expect((await me({ bearer: live.token })).status).toBe(401)
    expect(await tokenRows()).toBe(0)
  })

  it('answers invalid_token for an unknown or malformed token, and plain Bearer without one', async () => {
    const challenge = async (o: Options) => {
      const response = await me(o)
      expect(response.status).toBe(401)
      return response.headers.get('www-authenticate')
    }
    expect(await challenge({ bearer: newAccessToken() })).toBe('Bearer error="invalid_token"')
    expect(await challenge({ authorization: 'Bearer not-a-token' })).toBe('Bearer error="invalid_token"')
    expect(await challenge({})).toBe('Bearer')
    expect(await challenge({ authorization: 'Basic dXNlcjpwYXNz' })).toBe('Bearer')
  })

  it('writes last_used_at on first use, then at most every 10 minutes', async () => {
    await newUser()
    const { token, id } = await made()
    const lastUsed = async () =>
      (await raw<{ at: Date | null }[]>`select last_used_at as at from access_tokens where id = ${id}`)[0]?.at
    expect(await lastUsed()).toBeNull()
    await me({ bearer: token })
    const first = await lastUsed()
    expect(first).toBeInstanceOf(Date)
    await raw`update access_tokens set last_used_at = now() - interval '9 minutes' where id = ${id}`
    const nine = await lastUsed()
    await me({ bearer: token })
    expect(await lastUsed()).toEqual(nine)
    await raw`update access_tokens set last_used_at = now() - interval '11 minutes' where id = ${id}`
    await me({ bearer: token })
    expect((await lastUsed())?.getTime()).toBeGreaterThan(Date.now() - 60_000)
  })

  it('is signed out, logged redacted, when the lookup fails', async () => {
    await newUser()
    const { token } = await made()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = (() => {
      throw new Error(`lookup failed for ${token}`)
    }) as unknown as Sql
    vi.mocked(getDb).mockReturnValueOnce(broken)
    expect((await me({ bearer: token })).status).toBe(401)
    const line = String(errors.mock.calls[0]?.[0])
    expect(line).toMatch(/^\[access token lookup\]/)
    expect(line).toContain('folio_at_[redacted]')
    expect(line).not.toContain(token.slice(9))
  })

  it('is looked up once per request, and is signed out without a database', async () => {
    await newUser()
    const { token } = await made()
    const once = req('/api/me', { method: 'GET', bearer: token })
    vi.mocked(getDb).mockClear()
    expect((await handleMe(once)).status).toBe(200)
    expect((await handleMe(once)).status).toBe(200)
    expect(getDb).toHaveBeenCalledTimes(1)

    vi.mocked(isDatabaseConfigured).mockReturnValueOnce(false)
    expect((await me({ bearer: token })).status).toBe(401)
    vi.mocked(isDatabaseConfigured).mockReturnValueOnce(false)
    expect((await create({ username: 'ann', password: PASSWORD })).status).toBe(503)
    expect((await me({ bearer: token })).status).toBe(200)
  })

  it('answers 500 failed, logged without the body, when the database fails in a handler', async () => {
    await newUser()
    const { token, id } = await made()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const real = getDb()
    const broken = (() => {
      throw new Error('the database went away')
    }) as unknown as Sql
    vi.mocked(getDb).mockReturnValueOnce(broken)
    const failed = await create({ username: 'ann', password: PASSWORD })
    expect([failed.status, await failed.json()]).toEqual([500, { error: 'failed' }])
    vi.mocked(getDb).mockReturnValueOnce(real).mockReturnValueOnce(broken)
    expect((await list({ bearer: token })).status).toBe(500)
    vi.mocked(getDb).mockReturnValueOnce(real).mockReturnValueOnce(broken)
    expect((await revoke(id, { bearer: token })).status).toBe(500)
    const lines = errors.mock.calls.map((c) => String(c[0]))
    expect(lines.map((l) => l.slice(0, l.indexOf(']') + 1))).toEqual([
      '[access token create]',
      '[access token list]',
      '[access token revoke]',
    ])
    expect(lines.join('\n')).not.toContain(PASSWORD)
  })

  it('reads the role live', async () => {
    const ann = await newUser()
    const { token } = await made()
    await raw`update users set role = 'admin' where id = ${ann.id}`
    expect(await (await me({ bearer: token })).json()).toMatchObject({ role: 'admin' })
    expect((await findAccessToken(getDb(), hashToken(token)))?.userId).toBe(ann.id)
  })
})

describe('the rules', () => {
  it('lets the header alone decide when it is present', async () => {
    const ann = await newUser()
    const { cookie } = await withSession(ann.id)
    expect(await (await me({ cookie })).json()).toMatchObject({ username: 'ann', via: 'cookie' })
    expect((await me({ cookie, bearer: newAccessToken() })).status).toBe(401)
    expect((await me({ cookie, authorization: 'Basic dXNlcjpwYXNz' })).status).toBe(401)
    expect((await me({ cookie, authorization: '' })).status).toBe(401)
    const bob = await newUser('bob')
    const bobs = await made('bob')
    expect(await (await me({ cookie, bearer: bobs.token })).json()).toMatchObject({ username: 'bob', via: 'token' })
    void bob
  })

  it('takes a bearer request without an Origin, and the cookie from the app’s own', async () => {
    const ann = await newUser()
    const { token } = await made()
    const { cookie } = await withSession(ann.id)
    const shelf = (o: Options) => handleShelfCreate(req('/account/shelves/new', { body: { name: 'x' }, ...o }))
    expect((await shelf({ bearer: token, from: null })).status).toBe(201)
    expect((await shelf({ cookie, from: origin })).status).toBe(409)
    expect((await me({ cookie, from: null })).status).toBe(200)
  })

  it('ignores a token anywhere but the header', async () => {
    await newUser()
    const { token } = await made()
    expect((await handleMe(req(`/api/me?access_token=${token}`, { method: 'GET' }))).status).toBe(401)
    expect((await me({ cookie: `${cookieName}=${token}; token=${token}` })).status).toBe(401)
    const form = await handleShelfCreate(
      req('/account/shelves/new', { body: { name: 'x', access_token: token }, from: origin }),
    )
    expect(form.status).toBe(401)
  })

  it('is signed out everywhere a token isn’t allowed', async () => {
    const admin = await newUser('root', 'admin')
    const { token } = await made('root')
    const bearer = { bearer: token, from: origin }
    expect(await sessionForRequest(req('/account', bearer))).toBeNull()
    expect(await viewerForRequest(req('/library', { ...bearer, method: 'GET' }))).toBeNull()
    const account = await handleAccount(req('/account', { ...bearer, form: { intent: 'revoke-others' } }))
    expect(account.headers.get('location')).toMatch(/^\/login\?next=/)
    const keys = await handleApiKeys(req('/account/api-keys', { ...bearer, form: { intent: 'delete' } }))
    expect(keys.headers.get('location')).toMatch(/^\/login\?next=/)
    expect((await handleNewUser(req('/account/users/new', { ...bearer, body: { username: 'eve' } }))).status).toBe(401)
    expect((await handleAsk(req('/account/ask/x', { ...bearer, body: {} }), 'x')).status).toBe(401)
    expect((await handleAddOptions(req('/account/passkeys/options', { ...bearer, body: {} }))).status).toBe(401)
    expect((await raw`select 1 from users where username = 'eve'`).count).toBe(0)
    void admin
  })
})

describe('listing and revoking', () => {
  it('lists the account’s live tokens, newest first, marking the one in use, never the token', async () => {
    const ann = await newUser()
    const one = await made('ann', { name: 'one' })
    const two = await made('ann', { name: 'two' })
    await raw`update access_tokens set created_at = created_at - interval '1 minute' where id = ${one.id}`
    await newUser('bob')
    await made('bob')
    const response = await list({ bearer: one.token })
    const { tokens } = (await response.json()) as { tokens: { id: string; current: boolean }[] }
    expect(tokens.map((t) => [t.id, t.current])).toEqual([
      [two.id, false],
      [one.id, true],
    ])
    expect(Object.keys(tokens[0] ?? {})).toEqual(['id', 'name', 'createdAt', 'lastUsedAt', 'expiresAt', 'current'])
    expect(JSON.stringify(tokens)).not.toContain('folio_at_')
    const { cookie } = await withSession(ann.id)
    const byCookie = (await (await list({ cookie })).json()) as { tokens: { current: boolean }[] }
    expect(byCookie.tokens.map((t) => t.current)).toEqual([false, false])
    expect((await list()).status).toBe(401)
  })

  it('revokes the current token or one by id, and the token stops working', async () => {
    await newUser()
    const one = await made()
    const two = await made()
    const response = await revoke('current', { bearer: one.token })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ revoked: true })
    expect((await me({ bearer: one.token })).status).toBe(401)
    expect((await revoke(two.id, { bearer: two.token })).status).toBe(200)
    expect(await tokenRows()).toBe(0)
  })

  it('answers 404 for current without a token, another account’s id and a malformed id, changing nothing', async () => {
    const ann = await newUser()
    const { cookie } = await withSession(ann.id)
    await made()
    await newUser('bob')
    const bobs = await made('bob')
    const anns = await made()
    for (const [id, o] of [
      ['current', { cookie, from: origin }],
      [bobs.id, { bearer: anns.token }],
      [UNKNOWN_ID, { bearer: anns.token }],
      ['not-an-id', { bearer: anns.token }],
    ] as const) {
      const response = await revoke(id, o)
      expect(response.status, id).toBe(404)
      expect(await response.json()).toEqual({ error: 'not_found' })
    }
    expect(await tokenRows()).toBe(3)
    expect((await revoke('current', { cookie })).status).toBe(403)
    const bad = await handleTokenRevoke(
      req('/api/tokens/current', { body: { intent: 'delete' }, bearer: anns.token }),
      'current',
    )
    expect(bad.status).toBe(400)
  })

  it('revokes from the account page, and another account’s id changes nothing', async () => {
    const ann = await newUser()
    const { cookie } = await withSession(ann.id)
    const anns = await made()
    await newUser('bob')
    const bobs = await made('bob')
    const post = (token: string) =>
      handleAccount(req('/account', { cookie, from: origin, form: { intent: 'token-revoke', token } }))
    for (const id of [bobs.id, 'not-an-id', anns.id]) {
      const response = await post(id)
      expect(response.status).toBe(303)
      expect(response.headers.get('location')).toBe('/account?status=token-revoked#access-tokens')
    }
    expect((await raw<{ id: string }[]>`select id from access_tokens`).map((r) => r.id)).toEqual([bobs.id])
    expect(await events('token.revoked')).toEqual([{ id: anns.id, via: 'account page' }])
  })
})

describe('every place that ends sessions ends tokens', () => {
  async function annWithToken() {
    const ann = await newUser()
    const token = await made()
    await raw`delete from audit_events`
    return { ann, token }
  }

  const live = async (token: string) => (await me({ bearer: token })).status === 200

  it('Change password and Sign out everywhere else, counted in the event', async () => {
    const { ann, token } = await annWithToken()
    const { cookie } = await withSession(ann.id)
    const changed = await handleAccount(
      req('/account', {
        cookie,
        from: origin,
        form: {
          intent: 'change-password',
          current: PASSWORD,
          password: 'another long passphrase',
          confirm: 'another long passphrase',
        },
      }),
    )
    expect(changed.headers.get('location')).toBe('/account?status=password-changed')
    expect(await live(token.token)).toBe(false)
    expect(await events('password.changed')).toEqual([{ sessionsEnded: 0, tokensEnded: 1 }])
    expect(await events('token.revoked')).toEqual([{ id: token.id, via: 'password change' }])
    expect(await (await me({ cookie })).json()).toMatchObject({ via: 'cookie' })

    const second = await create({ username: 'ann', password: 'another long passphrase', expiresInDays: 1 })
    const { token: again } = (await second.json()) as Made
    await handleAccount(req('/account', { cookie, from: origin, form: { intent: 'revoke-others' } }))
    expect(await live(again)).toBe(false)
    expect((await events('sessions.revoked')).at(-1)).toEqual({ sessionsEnded: 0, tokensEnded: 1 })
  })

  it('a reset link', async () => {
    const { ann, token } = await annWithToken()
    await raw`update users set email = 'ann@example.com', email_verified_at = now() where id = ${ann.id}`
    const link = await createToken(getDb(), {
      userId: ann.id,
      purpose: 'reset',
      email: 'ann@example.com',
      limit: RESET_ACCOUNT_LIMIT,
    })
    if (link === 'limit') throw new Error('limit')
    const result = await resetPassword(getDb(), {
      tokenId: link.id,
      userId: ann.id,
      passwordHash: await hashPassword('another long passphrase', CHEAP),
      ip: IP,
    })
    expect(result).not.toBe('invalid')
    expect(await live(token.token)).toBe(false)
    expect(await events('password.changed')).toEqual([{ via: 'reset link', sessionsEnded: 0, tokensEnded: 1 }])
    expect(await events('token.revoked')).toEqual([{ id: token.id, via: 'reset' }])
  })

  it('the Users page’s reset password, disable and sign out', async () => {
    const root = await newUser('root', 'admin')
    const { cookie } = await withSession(root.id)
    const ann = await newUser()
    const change = (intent: string) =>
      handleUserChange(req('/account/users/ann', { cookie, from: origin, body: { intent } }), 'ann')
    for (const intent of ['reset-password', 'sign-out', 'disable']) {
      if (intent === 'disable') await raw`update users set disabled_at = null where id = ${ann.id}`
      const { token } = await made()
      expect((await change(intent)).status, intent).toBe(200)
      expect(await live(token), intent).toBe(false)
      if (intent === 'reset-password')
        await raw`update users set password_hash = ${await hashPassword(PASSWORD, CHEAP)} where id = ${ann.id}`
    }
    const details = [
      ...(await events('password.changed')),
      ...(await events('sessions.revoked')),
      ...(await events('user.disabled')),
    ]
    expect(details.map((d) => d.tokensEnded)).toEqual([1, 1, 1])
    expect((await events('token.revoked')).map((d) => d.via)).toEqual(['admin', 'admin', 'admin'])
  })

  it('setDisabledGuarded, and endUserAccess keeping the asking session', async () => {
    const { ann, token } = await annWithToken()
    expect(await setDisabledGuarded(getDb(), ann.id, true, { via: 'script' })).toEqual({
      sessionsEnded: 0,
      tokensEnded: 1,
    })
    expect(await live(token.token)).toBe(false)
    await raw`update users set disabled_at = null where id = ${ann.id}`
    const keep = await withSession(ann.id)
    await withSession(ann.id)
    expect(await endUserAccess(getDb(), ann.id, { keep: keep.hash, via: 'sign out everywhere' })).toEqual({
      sessionsEnded: 1,
      tokensEnded: 0,
    })
    expect(await sessionForRequest(req('/account', { cookie: keep.cookie }))).not.toBeNull()
  })

  it('the users script’s set-password, disable and revoke-sessions', async () => {
    const ann = await newUser()
    const run = (...args: string[]) =>
      execFileSync(process.execPath, ['scripts/db/users.ts', ...args], {
        env: { ...process.env, DATABASE_URL: databaseUrl },
        encoding: 'utf8',
      })
    for (const command of ['revoke-sessions', 'set-password', 'disable']) {
      await raw`update users set disabled_at = null, password_hash = ${await hashPassword(PASSWORD, CHEAP)} where id = ${ann.id}`
      const { token } = await made()
      expect(run(command, 'ann'), command).toContain('1 access token(s)')
      expect(await live(token), command).toBe(false)
    }
    expect((await events('token.revoked')).map((d) => d.via)).toEqual(['script', 'script', 'script'])
  })

  it('deleting the account (by the cascade)', async () => {
    const { ann } = await annWithToken()
    expect(await deleteAccount(getDb(), ann.id, { detail: { via: 'account page' } })).toBe('deleted')
    expect(await tokenRows()).toBe(0)
  })
})

describe('your data', () => {
  it('exports the tokens without their hashes', async () => {
    const ann = await newUser()
    const token = await made('ann', { name: 'CI' })
    const rows = await readAccount(getDb(), ann.id)
    expect(rows?.accessTokens).toEqual([
      {
        name: 'CI',
        createdAt: expect.any(Date),
        lastUsedAt: null,
        expiresAt: new Date(token.expiresAt),
        ip: IP,
        userAgent: 'access-tokens.db.test',
      },
    ])
  })
})
