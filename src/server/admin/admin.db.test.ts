import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { getConfig } from '~/server/config'
import { closeDb, getDb, type Pool } from '~/server/db'

vi.mock('~/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/server/db')>()
  return { ...actual, getDb: vi.fn(actual.getDb) }
})

import { handleLogin } from '~/server/account-actions'
import { USER_TABLES } from '~/server/account-data/export'
import { handleNewUser, handleUserChange, usersForAdmin } from '~/server/admin/actions'
import { type DeleteResult, deleteAccount, listForAdmin, setDisabledGuarded, setRole } from '~/server/admin/store'
import { sessionForRequest } from '~/server/auth'
import { recordAttempt } from '~/server/login-attempts'
import { hashPassword } from '~/server/passwords'
import { hashToken, newSessionToken } from '~/server/security'
import { createSession, findSession } from '~/server/sessions'
import { createUser, findUserByUsername, type Role } from '~/server/users'
import type { AdminUserView } from '~/shared/admin/users'
import { databaseUrl, freshDatabase } from '../testing/db'
import { ROWS_PER_USER, userWithEveryRow } from '../testing/user-rows'

const raw = postgres(databaseUrl, { max: 1, onnotice: () => {} })
const db = () => getDb()

beforeAll(freshDatabase)
afterAll(async () => {
  await raw.end()
  await closeDb()
})
beforeEach(async () => {
  await raw`truncate users, sessions, login_attempts, api_keys, audit_events, user_books, user_book_covers, user_book_images, highlights, bookmarks, flashcards, audio_bookmarks, reading_places, listening_places, reader_settings, shelves, shelf_books, email_tokens restart identity cascade`
})

const HASH = '$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA'
const newUser = (username: string, role: Role = 'member') => createUser(db(), username, HASH, role)

async function newSession(userId: number) {
  const token = newSessionToken()
  await createSession(db(), { tokenHash: hashToken(token), userId, ip: null, userAgent: 'test' })
  return hashToken(token)
}

const count = async (table: string) =>
  Number((await raw<{ n: string }[]>`select count(*) as n from ${raw(table)}`)[0]?.n)

describe('the foreign keys to users and user_books', () => {
  it('all cascade, except the audit trail’s, which keeps its rows', async () => {
    const keys = await raw<{ table: string; references: string; rule: string }[]>`
      select con.conrelid::regclass::text as table, con.confrelid::regclass::text as references,
        case con.confdeltype when 'c' then 'cascade' when 'n' then 'set null' else con.confdeltype::text end as rule
      from pg_constraint con
      where con.contype = 'f' and con.confrelid in ('users'::regclass, 'user_books'::regclass)
      order by 2, 1`
    const expected = Object.keys(USER_TABLES)
      .flatMap((table) =>
        table === 'audit_events'
          ? [`${table} set null`]
          : table === 'signup_tokens'
            ? [`${table} cascade`, `${table} set null`]
            : [`${table} cascade`],
      )
      .sort()
    expect(
      keys
        .filter((k) => k.references === 'users')
        .map((k) => `${k.table} ${k.rule}`)
        .sort(),
    ).toEqual(expected)
    expect(keys.filter((k) => k.references === 'user_books').every((k) => k.rule === 'cascade')).toBe(true)
  })
})

describe('deleteAccount', () => {
  it('removes every row of the user and none of anyone else’s, and keeps the audit trail', async () => {
    const gone = await userWithEveryRow(raw, 'gone')
    const kept = await userWithEveryRow(raw, 'kept')
    const result = await deleteAccount(getDb(), gone.userId, { ip: '198.51.100.4', detail: { via: 'account page' } })
    expect(result).toBe('deleted')
    expect(await findUserByUsername(db(), 'gone')).toBeNull()
    for (const [table, rows] of Object.entries(ROWS_PER_USER))
      expect([table, await count(table)]).toEqual([table, rows])
    expect((await raw`select 1 from login_attempts where username = 'gone'`).count).toBe(0)
    expect((await raw`select 1 from user_books where id = ${kept.bookId}`).count).toBe(1)

    const events = await raw<{ user_id: string | null; event: string; ip: string | null; detail: object }[]>`
      select user_id, event, host(ip) as ip, detail from audit_events where user_id is null order by id`
    expect(events).toEqual([
      { user_id: null, event: 'login.succeeded', ip: '203.0.113.5', detail: {} },
      { user_id: null, event: 'logout', ip: '203.0.113.5', detail: {} },
      {
        user_id: null,
        event: 'user.deleted',
        ip: '198.51.100.4',
        detail: { username: 'gone', role: 'member', via: 'account page' },
      },
    ])
  })

  it('lets the username be used again', async () => {
    const user = await newUser('again')
    await deleteAccount(getDb(), user.id, { detail: { via: 'users script' } })
    expect((await newUser('again')).username).toBe('again')
  })

  it('says missing for an unknown user', async () => {
    expect(await deleteAccount(getDb(), 999, { detail: { via: 'users page' } })).toBe('missing')
    expect(await count('audit_events')).toBe(0)
  })
})

describe('deleteAccount and the outside world', () => {
  it('deletes an account with no outbound HTTP call, and answers only deleted, last_admin or missing', async () => {
    expectTypeOf<DeleteResult>().toEqualTypeOf<'deleted' | 'last_admin' | 'missing'>()
    const outbound = vi.spyOn(globalThis, 'fetch')
    try {
      const user = await newUser('leaving')
      expect(await deleteAccount(getDb(), user.id, { detail: { via: 'account page' } })).toBe('deleted')
      const admin = await newUser('only', 'admin')
      expect(await deleteAccount(getDb(), admin.id, { detail: { via: 'users script' } })).toBe('last_admin')
      expect(outbound).not.toHaveBeenCalled()
    } finally {
      outbound.mockRestore()
    }
  })
})

describe('at least one enabled admin', () => {
  it('refuses to delete, demote or disable the only enabled admin', async () => {
    const only = await newUser('only', 'admin')
    await newUser('member')
    const disabled = await newUser('disabled-admin', 'admin')
    await raw`update users set disabled_at = now() where id = ${disabled.id}`
    expect(await deleteAccount(getDb(), only.id, { detail: { via: 'account page' } })).toBe('last_admin')
    expect(await setRole(getDb(), only.id, 'member')).toBe('last_admin')
    expect(await setDisabledGuarded(getDb(), only.id, true)).toBe('last_admin')
    expect(await findUserByUsername(db(), 'only')).toMatchObject({ role: 'admin', disabledAt: null })
    expect(await count('audit_events')).toBe(0)
    expect(await setRole(getDb(), only.id, 'admin')).toEqual({ from: 'admin', to: 'admin' })
    expect(await setDisabledGuarded(getDb(), only.id, false)).toEqual({ sessionsEnded: 0 })
  })

  it('allows it once another enabled admin exists, and always for a disabled admin', async () => {
    const a = await newUser('alpha', 'admin')
    const b = await newUser('beta', 'admin')
    expect(await setRole(getDb(), a.id, 'member')).toEqual({ from: 'admin', to: 'member' })
    expect(await setRole(getDb(), a.id, 'admin')).toEqual({ from: 'member', to: 'admin' })
    const session = await newSession(a.id)
    expect(await setDisabledGuarded(getDb(), a.id, true)).toEqual({ sessionsEnded: 1 })
    expect(await findSession(db(), session)).toBeNull()
    expect(await setDisabledGuarded(getDb(), b.id, true)).toBe('last_admin')
    expect(await setRole(getDb(), a.id, 'member')).toEqual({ from: 'admin', to: 'member' })
    expect(await deleteAccount(getDb(), a.id, { detail: { via: 'users page', by: b.id } })).toBe('deleted')
    expect(await setDisabledGuarded(getDb(), a.id, true)).toBe('missing')
    expect(await setRole(getDb(), a.id, 'admin')).toBe('missing')
  })

  it('lets only one of two admins demoting each other at once succeed', async () => {
    for (let round = 0; round < 5; round++) {
      await raw`truncate users restart identity cascade`
      const a = await newUser('alpha', 'admin')
      const b = await newUser('beta', 'admin')
      const results = await Promise.all([setRole(getDb(), a.id, 'member'), setRole(getDb(), b.id, 'member')])
      expect(results.filter((r) => r === 'last_admin')).toHaveLength(1)
      expect(Number((await raw`select count(*) as n from users where role = 'admin'`)[0]?.n)).toBe(1)
    }
  })

  it('lets only one of two admins deleting each other at once succeed', async () => {
    const a = await newUser('alpha', 'admin')
    const b = await newUser('beta', 'admin')
    const results = await Promise.all([
      deleteAccount(getDb(), a.id, { detail: { via: 'users page', by: b.id } }),
      deleteAccount(getDb(), b.id, { detail: { via: 'users page', by: a.id } }),
    ])
    expect([...results].sort()).toEqual(['deleted', 'last_admin'])
    expect(await count('users')).toBe(1)
  })
})

describe('listForAdmin', () => {
  it('lists every account by name, with its last activity, sessions, key and lock', async () => {
    const viewer = await newUser('zed', 'admin')
    await userWithEveryRow(raw, 'ada')
    const locked = await newUser('locked')
    for (let i = 0; i < 5; i++) await recordAttempt(db(), { username: 'locked', ip: null, succeeded: false })
    const ended = await newSession(locked.id)
    await raw`update sessions set expires_at = now() - interval '1 minute' where token_hash = ${ended}`

    await raw`update users set email = 'locked@example.com', email_verified_at = now(), email_bounced_at = now()
      where id = ${locked.id}`

    const rows = await listForAdmin(db(), viewer.id)
    expect(rows.map((r) => [r.username, r.role, r.sessions, r.hasKey, r.email, r.you])).toEqual([
      ['ada', 'member', 1, true, 'confirmed', false],
      ['locked', 'member', 0, false, 'bounced', false],
      ['zed', 'admin', 0, false, 'none', true],
    ])
    expect(rows[0]?.lastActiveAt).toBeInstanceOf(Date)
    expect(rows[0]?.lockedUntil).toBeNull()
    expect(rows[1]?.lastActiveAt).toBeNull()
    expect(rows[1]?.lockedUntil).toBeInstanceOf(Date)
  })
})

describe('the Users page handlers', () => {
  const origin = getConfig().appOrigin
  const cookieName = getConfig().cookieSecure ? '__Host-session' : 'session'
  const PASSWORD = 'a long enough password for tests'

  async function signedIn(username: string, role: Role = 'admin') {
    const user = await createUser(db(), username, await hashPassword(PASSWORD), role)
    const token = newSessionToken()
    await createSession(db(), { tokenHash: hashToken(token), userId: user.id, ip: null, userAgent: 'test' })
    return { user, cookie: `${cookieName}=${token}`, tokenHash: hashToken(token) }
  }

  const request = (path: string, cookie: string | null, body: unknown, headers: Record<string, string> = {}) =>
    new Request(`${origin}${path}`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  const add = (cookie: string | null, body: unknown, headers?: Record<string, string>) =>
    handleNewUser(request('/account/users/new', cookie, body, headers))
  const change = (cookie: string | null, username: string, body: unknown, headers?: Record<string, string>) =>
    handleUserChange(request(`/account/users/${username}`, cookie, body, headers), username)

  const answer = async (response: Response) => [
    response.status,
    response.status === 403 ? null : (((await response.json()) as { error?: string }).error ?? null),
  ]

  const signsIn = async (username: string, password: string) => {
    const response = await handleLogin(
      new Request(`${origin}/login`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username, password }),
      }),
    )
    return response.headers.get('location') === '/library'
  }

  const audited = (event: string) =>
    raw<{ user_id: string | null; detail: Record<string, unknown> }[]>`
      select user_id, detail from audit_events where event = ${event} order by id`

  it('refuses a signed-out visitor and a member', async () => {
    const member = await signedIn('member', 'member')
    expect(await answer(await add(null, { username: 'ada' }))).toEqual([401, 'signed_out'])
    expect(await answer(await change(null, 'member', { intent: 'disable' }))).toEqual([401, 'signed_out'])
    expect(await answer(await add(member.cookie, { username: 'ada' }))).toEqual([404, 'not_found'])
    expect(await answer(await change(member.cookie, 'member', { intent: 'delete' }))).toEqual([404, 'not_found'])
    expect(await findUserByUsername(db(), 'ada')).toBeNull()
  })

  it('refuses a bad body, a malformed or unknown username, your own account and a taken name', async () => {
    const admin = await signedIn('boss')
    await newUser('ada')
    expect(await answer(await add(admin.cookie, '{nope'))).toEqual([400, 'invalid'])
    expect(await answer(await add(admin.cookie, { username: 'x' }))).toEqual([400, 'invalid'])
    expect(await answer(await add(admin.cookie, { username: 'new' }))).toEqual([400, 'invalid'])
    expect(await answer(await change(admin.cookie, 'ada', { intent: 'promote' }))).toEqual([400, 'invalid'])
    expect(await answer(await change(admin.cookie, 'Not A Name', { intent: 'disable' }))).toEqual([404, 'not_found'])
    expect(await answer(await change(admin.cookie, 'nobody', { intent: 'disable' }))).toEqual([404, 'not_found'])
    expect(await answer(await change(admin.cookie, 'boss', { intent: 'disable' }))).toEqual([409, 'self'])
    expect(await answer(await add(admin.cookie, { username: 'ADA' }))).toEqual([409, 'taken'])
  })

  it('adds an account whose password, shown once, signs in', async () => {
    const admin = await signedIn('boss')
    const response = await add(admin.cookie, { username: ' Ada ', role: 'member' })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const { user, password } = (await response.json()) as { user: AdminUserView; password: string }
    expect(user).toMatchObject({ username: 'ada', role: 'member', status: 'active', sessions: 0, you: false })
    expect(password).toHaveLength(24)
    expect(await signsIn('ada', password)).toBe(true)
    const [event] = await audited('user.created')
    expect(event).toEqual({
      user_id: String((await findUserByUsername(db(), 'ada'))?.id),
      detail: { via: 'users page', by: admin.user.id, role: 'member' },
    })
    expect(JSON.stringify(await raw`select detail from audit_events`)).not.toContain(password)
  })

  it('resets a password: old sessions end, the lock clears, and the new password signs in', async () => {
    const admin = await signedIn('boss')
    const ada = await signedIn('ada', 'member')
    for (let i = 0; i < 5; i++) await recordAttempt(db(), { username: 'ada', ip: null, succeeded: false })
    const response = await change(admin.cookie, 'ada', { intent: 'reset-password' })
    const { user, password } = (await response.json()) as { user: AdminUserView; password: string }
    expect(user).toMatchObject({ username: 'ada', status: 'active', sessions: 0 })
    expect(await findSession(db(), ada.tokenHash)).toBeNull()
    expect(await signsIn('ada', PASSWORD)).toBe(false)
    expect(await signsIn('ada', password)).toBe(true)
    expect((await audited('password.changed'))[0]?.detail).toEqual({
      via: 'users page',
      by: admin.user.id,
      sessionsEnded: 1,
      failuresCleared: 5,
    })
  })

  it('disables, enables, unlocks and signs out, each audited', async () => {
    const admin = await signedIn('boss')
    const ada = await signedIn('ada', 'member')
    const row = async (response: Response) => ((await response.json()) as { user: AdminUserView }).user
    expect(await row(await change(admin.cookie, 'ada', { intent: 'disable' }))).toMatchObject({
      status: 'disabled',
      sessions: 0,
    })
    expect(await findSession(db(), ada.tokenHash)).toBeNull()
    expect((await row(await change(admin.cookie, 'ada', { intent: 'enable' }))).status).toBe('active')

    for (let i = 0; i < 5; i++) await recordAttempt(db(), { username: 'ada', ip: null, succeeded: false })
    expect((await listForAdmin(db(), admin.user.id, 'ada'))[0]?.lockedUntil).toBeInstanceOf(Date)
    expect(await row(await change(admin.cookie, 'ada', { intent: 'unlock' }))).toMatchObject({
      status: 'active',
      lockedUntil: null,
    })

    await newSession(ada.user.id)
    await newSession(ada.user.id)
    expect((await row(await change(admin.cookie, 'ada', { intent: 'sign-out' }))).sessions).toBe(0)

    const by = { via: 'users page', by: admin.user.id }
    expect((await audited('user.disabled'))[0]?.detail).toEqual({ ...by, sessionsEnded: 1 })
    expect((await audited('user.enabled'))[0]?.detail).toEqual({ ...by, sessionsEnded: 0 })
    expect((await audited('user.unlocked'))[0]?.detail).toEqual({ ...by, failuresCleared: 5 })
    expect((await audited('sessions.revoked'))[0]?.detail).toEqual({ ...by, sessionsEnded: 2 })
  })

  it('changes a role, which holds from the user’s next request', async () => {
    const admin = await signedIn('boss')
    const ada = await signedIn('ada', 'member')
    const made = await change(admin.cookie, 'ada', { intent: 'role', role: 'admin' })
    expect(((await made.json()) as { user: AdminUserView }).user.role).toBe('admin')
    expect((await findSession(db(), ada.tokenHash))?.role).toBe('admin')
    await change(admin.cookie, 'ada', { intent: 'role', role: 'admin' })
    await change(admin.cookie, 'ada', { intent: 'role', role: 'member' })
    expect((await findSession(db(), ada.tokenHash))?.role).toBe('member')
    expect((await audited('user.role_changed')).map((e) => e.detail)).toEqual([
      { via: 'users page', by: admin.user.id, from: 'member', to: 'admin' },
      { via: 'users page', by: admin.user.id, from: 'admin', to: 'member' },
    ])
  })

  it('deletes an account', async () => {
    const admin = await signedIn('boss')
    await userWithEveryRow(raw, 'ada')
    const response = await change(admin.cookie, 'ada', { intent: 'delete' })
    expect([response.status, await response.json()]).toEqual([200, { deleted: 'ada' }])
    expect(await findUserByUsername(db(), 'ada')).toBeNull()
    expect((await audited('user.deleted'))[0]).toEqual({
      user_id: null,
      detail: { username: 'ada', role: 'member', via: 'users page', by: admin.user.id },
    })
  })

  it('refuses to leave no admin when two admins act on each other at once', async () => {
    const alpha = await signedIn('alpha')
    const beta = await signedIn('beta')
    const demote = request('/account/users/alpha', beta.cookie, { intent: 'role', role: 'member' })
    const disable = request('/account/users/alpha', beta.cookie, { intent: 'disable' })
    const remove = request('/account/users/alpha', beta.cookie, { intent: 'delete' })
    for (const late of [demote, disable, remove]) expect((await sessionForRequest(late))?.role).toBe('admin')
    expect((await change(alpha.cookie, 'beta', { intent: 'role', role: 'member' })).status).toBe(200)
    expect(await answer(await handleUserChange(demote, 'alpha'))).toEqual([409, 'last_admin'])
    expect(await answer(await handleUserChange(disable, 'alpha'))).toEqual([409, 'last_admin'])
    expect(await answer(await handleUserChange(remove, 'alpha'))).toEqual([409, 'last_admin'])
    expect(await findUserByUsername(db(), 'alpha')).toMatchObject({ role: 'admin', disabledAt: null })
  })

  it('answers 500 failed when the database fails, and logs it', async () => {
    const admin = await signedIn('boss')
    await newUser('ada')
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = (() => {
      throw new Error('the database went away')
    }) as unknown as Pool
    try {
      vi.mocked(getDb).mockReturnValueOnce(getDb()).mockReturnValueOnce(broken)
      expect(await answer(await add(admin.cookie, { username: 'zoe' }))).toEqual([500, 'failed'])
      vi.mocked(getDb).mockReturnValueOnce(getDb()).mockReturnValueOnce(broken)
      expect(await answer(await change(admin.cookie, 'ada', { intent: 'disable' }))).toEqual([500, 'failed'])
      expect(errors.mock.calls.map((call) => String(call[0]))).toEqual([
        expect.stringMatching(/^\[users page add\] /),
        expect.stringMatching(/^\[users page change\] /),
      ])
    } finally {
      errors.mockRestore()
    }
  })
})

describe('usersForAdmin', () => {
  it('is null for a member, and marks the admin’s own row and a locked user', async () => {
    const admin = await newUser('boss', 'admin')
    const member = await newUser('ada')
    for (let i = 0; i < 5; i++) await recordAttempt(db(), { username: 'ada', ip: null, succeeded: false })
    const session = (user: { id: number; username: string; role: Role }) => ({
      userId: user.id,
      username: user.username,
      role: user.role,
      expiresAt: new Date(),
    })
    expect(await usersForAdmin(session(member))).toBeNull()
    const users = await usersForAdmin(session(admin))
    expect(users?.map((u) => [u.username, u.status, u.you])).toEqual([
      ['ada', 'locked', false],
      ['boss', 'active', true],
    ])
    expect(users?.[0]?.lockedUntil).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(JSON.stringify(users)).not.toMatch(/"id"/)
  })
})
