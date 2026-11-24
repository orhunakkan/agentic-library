import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleAccount, handleApiKeys } from '~/server/account-actions'
import { deleteKey, getKeyStatuses, rotateKeys, saveKey, withApiKey } from '~/server/api-keys'
import { recordEvent } from '~/server/audit'
import { getConfig, type Kek, kekId } from '~/server/config'
import { closeDb, getDb } from '~/server/db'
import {
  beginAttempt,
  clearFailures,
  discardAttempt,
  ipBlockedUntil,
  markSucceeded,
  recordAttempt,
  sweepAttempts,
  usernameLockedUntil,
} from '~/server/login-attempts'
import { hashPassword } from '~/server/passwords'
import { API_KEY_LIMIT } from '~/server/rate-limit'
import { hashToken, newSessionToken } from '~/server/security'
import {
  createSession,
  deleteSession,
  deleteUserSessions,
  findSession,
  listSessions,
  sweepSessions,
} from '~/server/sessions'
import {
  findUserByUsername,
  getAiModel,
  getSpeechModel,
  listUsers,
  setAiModel,
  setDisabled,
  setPasswordHash,
} from '~/server/users'
import { anthropicStub } from '../../tests/e2e/support/anthropic-stub'
import { elevenLabsKey, elevenLabsStub, STUB_ELEVENLABS_KEYS } from '../../tests/e2e/support/elevenlabs-stub'
import { databaseUrl, freshDatabase } from './testing/db'
import { spend } from './testing/quota'
import { testUser } from './testing/users'

const raw = postgres(databaseUrl, { max: 1, onnotice: () => {} })
const db = () => getDb()
const KEY = 'sk-ant-api03-a-test-key-that-is-long-enough-0001'

beforeAll(freshDatabase)
afterAll(async () => {
  await raw.end()
  await closeDb()
})
beforeEach(async () => {
  await raw`truncate users, sessions, login_attempts, api_keys, audit_events restart identity cascade`
})

const newUser = (username = 'reader', role: 'admin' | 'member' = 'member') =>
  testUser(db(), username, '$argon2id$v=19$m=1024,t=1,p=1$c2FsdHNhbHQ$aGFzaGhhc2g', role)

async function newSession(userId: number) {
  const token = newSessionToken()
  await createSession(db(), { tokenHash: hashToken(token), userId, ip: '203.0.113.9', userAgent: 'x'.repeat(500) })
  return hashToken(token)
}

describe('users', () => {
  it('lowercases usernames and enforces their shape in the database', async () => {
    const user = await newUser('Orhun', 'admin')
    expect(user.username).toBe('orhun')
    expect((await findUserByUsername(db(), 'ORHUN'))?.id).toBe(user.id)
    await expect(raw`insert into users (username, password_hash) values ('x', 'h')`).rejects.toThrow(/check/)
    await expect(raw`insert into users (username, password_hash) values ('Upper', 'h')`).rejects.toThrow(/check/)
    await expect(
      raw`insert into users (username, password_hash, role) values ('ok-name', 'h', 'root')`,
    ).rejects.toThrow(/check/)
    await expect(newUser('orhun')).rejects.toThrow(/unique/)
  })

  it('records password changes and disabling', async () => {
    const user = await newUser()
    await raw`update users set password_changed_at = now() - interval '1 day' where id = ${user.id}`
    await setPasswordHash(db(), user.id, 'rehash', false)
    const rehashed = await findUserByUsername(db(), 'reader')
    expect(rehashed?.passwordHash).toBe('rehash')
    expect(Date.now() - (rehashed?.passwordChangedAt.getTime() ?? 0)).toBeGreaterThan(20 * 60 * 60 * 1000)
    await setPasswordHash(db(), user.id, 'changed')
    expect(Date.now() - ((await findUserByUsername(db(), 'reader'))?.passwordChangedAt.getTime() ?? 0)).toBeLessThan(
      60_000,
    )
    await setDisabled(db(), user.id, true)
    expect((await findUserByUsername(db(), 'reader'))?.disabledAt).toBeInstanceOf(Date)
    await setDisabled(db(), user.id, false)
    expect((await findUserByUsername(db(), 'reader'))?.disabledAt).toBeNull()
  })

  it('lists users with their active sessions, whether a key is saved and their email status', async () => {
    const a = await newUser('alice', 'admin')
    await newUser('bob')
    const c = await newUser('cyril')
    await newSession(a.id)
    await saveKey(db(), a.id, 'anthropic', KEY)
    await raw`update users set email = 'alice@example.com', email_verified_at = now() where id = ${a.id}`
    await raw`update users set email = 'c@example.com', email_verified_at = now(), email_bounced_at = now()
      where id = ${c.id}`
    expect((await listUsers(db())).map((u) => [u.username, u.role, u.activeSessions, u.hasApiKey, u.email])).toEqual([
      ['alice', 'admin', 1, true, 'confirmed'],
      ['bob', 'member', 0, false, 'none'],
      ['cyril', 'member', 0, false, 'bounced'],
    ])
  })
})

describe('sessions', () => {
  it('finds a live session by token hash and truncates the user agent', async () => {
    const user = await newUser('reader', 'admin')
    const hash = await newSession(user.id)
    expect(await findSession(db(), hash)).toMatchObject({ userId: user.id, username: 'reader', role: 'admin' })
    const [row] = await raw<{ ua: string; days: number }[]>`
      select user_agent as ua, extract(day from expires_at - created_at)::int as days from sessions`
    expect(row?.ua).toHaveLength(300)
    expect(row?.days).toBe(30)
    expect(await findSession(db(), hashToken(newSessionToken()))).toBeNull()
  })

  it('ends sessions 30 days after creation, after 7 idle days, or when the user is disabled', async () => {
    const user = await newUser()
    const expired = await newSession(user.id)
    await raw`update sessions set expires_at = now() - interval '1 second' where token_hash = ${expired}`
    expect(await findSession(db(), expired)).toBeNull()

    const idle = await newSession(user.id)
    await raw`update sessions set last_seen_at = now() - interval '7 days 1 minute' where token_hash = ${idle}`
    expect(await findSession(db(), idle)).toBeNull()

    const live = await newSession(user.id)
    await setDisabled(db(), user.id, true)
    expect(await findSession(db(), live)).toBeNull()
    expect((await raw`select 1 from sessions`).count).toBe(0)
  })

  it('updates last_seen_at at most every 10 minutes', async () => {
    const user = await newUser()
    const hash = await newSession(user.id)
    const lastSeen = async () =>
      (await raw<{ t: Date }[]>`select last_seen_at as t from sessions where token_hash = ${hash}`)[0]?.t.getTime()
    await raw`update sessions set last_seen_at = now() - interval '5 minutes' where token_hash = ${hash}`
    const before = await lastSeen()
    await findSession(db(), hash)
    expect(await lastSeen()).toBe(before)
    await raw`update sessions set last_seen_at = now() - interval '11 minutes' where token_hash = ${hash}`
    await findSession(db(), hash)
    expect(Date.now() - ((await lastSeen()) ?? 0)).toBeLessThan(60_000)
  })

  it('signs out everywhere else, lists sessions and sweeps ended ones', async () => {
    const user = await newUser()
    const mine = await newSession(user.id)
    await newSession(user.id)
    const old = await newSession(user.id)
    await raw`update sessions set expires_at = now() - interval '1 second' where token_hash = ${old}`
    const listed = await listSessions(db(), user.id, mine)
    expect(listed.map((s) => s.current)).toEqual([true, false])
    expect(listed[0]?.ip).toBe('203.0.113.9')
    await sweepSessions(db())
    expect((await raw`select 1 from sessions`).count).toBe(2)
    expect(await deleteUserSessions(db(), user.id, mine)).toBe(1)
    expect(await findSession(db(), mine)).not.toBeNull()
    await deleteSession(db(), mine)
    expect(await findSession(db(), mine)).toBeNull()
  })

  it('ends every session of the user when none is kept, and no one else’s', async () => {
    const user = await newUser()
    const other = await newUser('other')
    await newSession(user.id)
    await newSession(user.id)
    const theirs = await newSession(other.id)
    expect(await deleteUserSessions(db(), user.id)).toBe(2)
    expect(await listSessions(db(), user.id, theirs)).toEqual([])
    expect(await findSession(db(), theirs)).not.toBeNull()
  })
})

describe('sign-in limits', () => {
  it('locks a username after 5 failures in 15 minutes, ignoring failures before a success', async () => {
    for (let i = 0; i < 4; i++) await recordAttempt(db(), { username: 'Reader', ip: '198.51.100.1', succeeded: false })
    expect(await usernameLockedUntil(db(), 'reader')).toBeNull()
    await recordAttempt(db(), { username: 'reader', ip: '198.51.100.2', succeeded: false })
    const until = await usernameLockedUntil(db(), 'reader')
    expect((until?.getTime() ?? 0) - Date.now()).toBeGreaterThan(14 * 60_000)

    await clearFailures(db(), 'reader')
    expect(await usernameLockedUntil(db(), 'reader')).toBeNull()

    for (let i = 0; i < 4; i++) await recordAttempt(db(), { username: 'reader', ip: null, succeeded: false })
    await recordAttempt(db(), { username: 'reader', ip: null, succeeded: true })
    await recordAttempt(db(), { username: 'reader', ip: null, succeeded: false })
    expect(await usernameLockedUntil(db(), 'reader')).toBeNull()
  })

  it('counts only the attempts recorded before this one, so a parallel burst checks at most 5 passwords', async () => {
    const burst = []
    for (let i = 0; i < 10; i++) burst.push(await beginAttempt(db(), { username: 'reader', ip: '198.51.100.3' }))
    const allowed = []
    for (const attempt of burst) {
      if (await usernameLockedUntil(db(), 'reader', attempt)) await discardAttempt(db(), attempt)
      else allowed.push(attempt)
    }
    expect(allowed).toEqual(burst.slice(0, 5))
    expect((await raw`select 1 from login_attempts`).count).toBe(5)
    expect(await usernameLockedUntil(db(), 'reader')).toBeInstanceOf(Date)
  })

  it('a successful attempt clears the earlier failures', async () => {
    for (let i = 0; i < 4; i++) await recordAttempt(db(), { username: 'reader', ip: null, succeeded: false })
    const ok = await beginAttempt(db(), { username: 'reader', ip: null })
    expect(await usernameLockedUntil(db(), 'reader', ok)).toBeNull()
    await markSucceeded(db(), ok)
    await recordAttempt(db(), { username: 'reader', ip: null, succeeded: false })
    expect(await usernameLockedUntil(db(), 'reader')).toBeNull()
  })

  it('stops counting failures once the lock has passed', async () => {
    for (let i = 0; i < 5; i++) await recordAttempt(db(), { username: 'reader', ip: null, succeeded: false })
    await raw`update login_attempts set at = at - interval '16 minutes'`
    expect(await usernameLockedUntil(db(), 'reader')).toBeNull()
  })

  it('blocks an IP after 30 failures in 15 minutes', async () => {
    for (let i = 0; i < 29; i++)
      await recordAttempt(db(), { username: `user${i}`, ip: '198.51.100.7', succeeded: false })
    expect(await ipBlockedUntil(db(), '198.51.100.7')).toBeNull()
    await recordAttempt(db(), { username: 'user29', ip: '198.51.100.7', succeeded: false })
    expect(await ipBlockedUntil(db(), '198.51.100.7')).toBeInstanceOf(Date)
    expect(await ipBlockedUntil(db(), '198.51.100.8')).toBeNull()
    expect(await ipBlockedUntil(db(), null)).toBeNull()
  })

  it('deletes attempts older than 30 days', async () => {
    await recordAttempt(db(), { username: 'reader', ip: null, succeeded: false })
    await recordAttempt(db(), { username: 'reader', ip: null, succeeded: false })
    await raw`update login_attempts set at = now() - interval '31 days' where id = 1`
    await sweepAttempts(db())
    expect((await raw`select id from login_attempts`).map((r) => r.id)).toEqual(['2'])
  })
})

describe('API keys', () => {
  it('stores only ciphertext and the last four characters', async () => {
    const user = await newUser()
    await saveKey(db(), user.id, 'anthropic', KEY)
    const [row] = await raw<{ ciphertext: Buffer; iv: Buffer; auth_tag: Buffer; last4: string; kek_id: number }[]>`
      select ciphertext, iv, auth_tag, last4, kek_id from api_keys`
    expect(row?.ciphertext.toString('utf8')).not.toContain('sk-ant')
    expect(row?.ciphertext.toString('hex')).not.toContain(Buffer.from(KEY).toString('hex'))
    expect(row?.iv).toHaveLength(12)
    expect(row?.auth_tag).toHaveLength(16)
    expect(row?.last4).toBe('0001')
    expect(row?.kek_id).toBe(getConfig().kek?.id)
    const dump = JSON.stringify(await raw`select * from api_keys`)
    expect(dump).not.toContain(KEY)
  })

  it('replaces, decrypts inside withApiKey only, records use, and deletes', async () => {
    const user = await newUser()
    await saveKey(db(), user.id, 'anthropic', KEY)
    await saveKey(db(), user.id, 'anthropic', `${KEY.slice(0, -4)}9999`)
    expect((await raw`select 1 from api_keys`).count).toBe(1)
    const seen = await withApiKey(user.id, 'anthropic', async (key) => key)
    expect(seen.endsWith('9999')).toBe(true)
    const [status] = await getKeyStatuses(db(), user.id)
    expect(status).toMatchObject({ provider: 'anthropic', last4: '9999' })
    expect(status?.lastUsedAt).toBeInstanceOf(Date)
    expect(Object.keys(status ?? {})).not.toContain('ciphertext')
    expect(await deleteKey(db(), user.id, 'anthropic')).toBe(true)
    await expect(withApiKey(user.id, 'anthropic', async (k) => k)).rejects.toThrow(/No anthropic API key/)
  })

  it('will not decrypt a ciphertext copied to another user', async () => {
    const a = await newUser('alice')
    const b = await newUser('bob')
    await saveKey(db(), a.id, 'anthropic', KEY)
    await raw`
      insert into api_keys (user_id, provider, ciphertext, iv, auth_tag, kek_id, last4)
      select ${b.id}, provider, ciphertext, iv, auth_tag, kek_id, last4 from api_keys where user_id = ${a.id}`
    await expect(withApiKey(b.id, 'anthropic', async (k) => k)).rejects.toThrow()
  })

  it('rotates rows from the previous KEK to the current one', async () => {
    const user = await newUser()
    const previous: Kek = { key: Buffer.alloc(32, 3), id: kekId(Buffer.alloc(32, 3)) }
    const current = getConfig().kek as Kek
    await saveKey(db(), user.id, 'anthropic', KEY, previous)
    expect(await rotateKeys(db(), current, null)).toEqual({ rotated: 0, unreadable: 1 })
    expect(await rotateKeys(db(), current, previous)).toEqual({ rotated: 1, unreadable: 0 })
    expect(await rotateKeys(db(), current, previous)).toEqual({ rotated: 0, unreadable: 0 })
    expect(await withApiKey(user.id, 'anthropic', async (k) => k)).toBe(KEY)
  })

  it('refuses to open a key sealed with a KEK the server no longer has', async () => {
    const user = await newUser()
    const retired: Kek = { key: Buffer.alloc(32, 7), id: kekId(Buffer.alloc(32, 7)) }
    await saveKey(db(), user.id, 'anthropic', KEY, retired)
    const used = vi.fn(async (key: string) => key)
    await expect(withApiKey(user.id, 'anthropic', used)).rejects.toThrow(/encrypted with an unknown KEK/)
    expect(used).not.toHaveBeenCalled()
  })

  it('stores nothing when no KEK is configured', async () => {
    const user = await newUser()
    const config = getConfig() as { kek: Kek | null }
    const kek = config.kek
    config.kek = null
    try {
      await expect(saveKey(db(), user.id, 'anthropic', KEY)).rejects.toThrow(/No KEK is configured/)
    } finally {
      config.kek = kek
    }
    expect((await raw`select 1 from api_keys`).count).toBe(0)
  })
})

describe('the model for agent features', () => {
  it('is a nullable column, read as the default until one is chosen', async () => {
    const [column] = await raw<{ is_nullable: string; data_type: string }[]>`
      select is_nullable, data_type from information_schema.columns
      where table_name = 'users' and column_name = 'ai_model'`
    expect(column).toEqual({ is_nullable: 'YES', data_type: 'text' })
    const user = await newUser()
    expect(user.aiModel).toBe('claude-opus-5-5')
    expect(await getAiModel(db(), user.id)).toBe('claude-opus-5-5')
    expect(await getAiModel(db(), 999_999)).toBe('claude-opus-5-5')
  })

  it('saves a choice and returns the one it replaced', async () => {
    const user = await newUser()
    expect(await setAiModel(db(), user.id, 'claude-haiku-5-5')).toBe('claude-opus-5-5')
    expect(await getAiModel(db(), user.id)).toBe('claude-haiku-5-5')
    expect(await setAiModel(db(), user.id, 'claude-sonnet-5-5')).toBe('claude-haiku-5-5')
    expect((await findUserByUsername(db(), 'reader'))?.aiModel).toBe('claude-sonnet-5-5')
  })

  it('reads a stored id the code no longer lists as the default', async () => {
    const user = await newUser()
    await raw`update users set ai_model = 'claude-retired-1' where id = ${user.id}`
    expect(await getAiModel(db(), user.id)).toBe('claude-opus-5-5')
  })

  describe('the form post', () => {
    const origin = getConfig().appOrigin
    const cookieName = getConfig().cookieSecure ? '__Host-session' : 'session'
    const post = (cookie: string | null, body: Record<string, string>, headers: Record<string, string> = {}) =>
      handleApiKeys(
        new Request(`${origin}/account/api-keys`, {
          method: 'POST',
          headers: {
            origin,
            'content-type': 'application/x-www-form-urlencoded',
            ...(cookie ? { cookie } : {}),
            ...headers,
          },
          body: new URLSearchParams(body),
        }),
      )

    async function signedIn() {
      const user = await newUser()
      const token = newSessionToken()
      await createSession(db(), { tokenHash: hashToken(token), userId: user.id, ip: null, userAgent: 'test' })
      return { user, cookie: `${cookieName}=${token}` }
    }

    it('saves the model and audits a change, but not a save that changes nothing', async () => {
      const { user, cookie } = await signedIn()
      const saved = await post(cookie, { intent: 'model', model: 'claude-sonnet-5-5' })
      expect([saved.status, saved.headers.get('location')]).toEqual([303, '/account/api-keys?status=model-saved#model'])
      expect(await getAiModel(db(), user.id)).toBe('claude-sonnet-5-5')
      await post(cookie, { intent: 'model', model: 'claude-sonnet-5-5' })
      const events = await raw<{ detail: unknown }[]>`
        select detail from audit_events where event = 'ai_model.changed' and user_id = ${user.id}`
      expect(events.map((e) => e.detail)).toEqual([{ from: 'claude-opus-5-5', to: 'claude-sonnet-5-5' }])
    })

    it('refuses unknown models and a missing session', async () => {
      const { user, cookie } = await signedIn()
      const bad = await post(cookie, { intent: 'model', model: 'claude-made-up-9' })
      expect(bad.headers.get('location')).toBe('/account/api-keys?error=invalid#model')
      const anonymous = await post(null, { intent: 'model', model: 'claude-haiku-5-5' })
      expect(anonymous.headers.get('location')).toMatch(/^\/login\?/)
      expect(await getAiModel(db(), user.id)).toBe('claude-opus-5-5')
    })

    it('is not held back by the key-change limit', async () => {
      const { user, cookie } = await signedIn()
      await spend(db(), user.id, 'api-key', API_KEY_LIMIT.max)
      const saved = await post(cookie, { intent: 'model', model: 'claude-haiku-5-5' })
      expect(saved.headers.get('location')).toBe('/account/api-keys?status=model-saved#model')
    })
  })
})

describe('the key form posts', () => {
  const origin = getConfig().appOrigin
  const cookieName = getConfig().cookieSecure ? '__Host-session' : 'session'
  const stubs = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    return url.includes('elevenlabs') ? elevenLabsStub(new Request(url, init)) : anthropicStub(new Request(url, init))
  }) as typeof fetch
  const post = (cookie: string, body: Record<string, string>, fetchFn: typeof fetch = stubs) =>
    handleApiKeys(
      new Request(`${origin}/account/api-keys`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/x-www-form-urlencoded', cookie },
        body: new URLSearchParams(body),
      }),
      { fetch: fetchFn },
    )
  const save = (cookie: string, provider: string, key: string) => post(cookie, { intent: 'save', provider, key })
  const at = (query: string, anchor: string) => `/account/api-keys?${query}#${anchor}`

  async function signedIn() {
    const user = await newUser()
    const token = newSessionToken()
    await createSession(db(), { tokenHash: hashToken(token), userId: user.id, ip: null, userAgent: 'test' })
    return { user, cookie: `${cookieName}=${token}` }
  }

  const keyEvents = (userId: number) =>
    raw<{ event: string; detail: unknown }[]>`
      select event, detail from audit_events where user_id = ${userId} and event like 'api_key.%' order by id`

  it('saves an ElevenLabs key the voices endpoint accepts, beside an Anthropic one', async () => {
    const { user, cookie } = await signedIn()
    const anthropic = await save(cookie, 'anthropic', 'sk-ant-test-valid-xxxxxxxxxxxxxxxx1111')
    expect(anthropic.headers.get('location')).toBe(at('status=saved&provider=anthropic', 'anthropic'))
    const saved = await save(cookie, 'elevenlabs', `  ${elevenLabsKey('9876')}  `)
    expect(saved.headers.get('location')).toBe(at('status=saved&provider=elevenlabs', 'elevenlabs'))
    expect(await getKeyStatuses(db(), user.id)).toMatchObject([
      { provider: 'anthropic', last4: '1111' },
      { provider: 'elevenlabs', last4: '9876' },
    ])
    expect(await withApiKey(user.id, 'elevenlabs', async (k) => k)).toBe(elevenLabsKey('9876'))
    expect(await withApiKey(user.id, 'anthropic', async (k) => k)).toMatch(/1111$/)
    expect((await keyEvents(user.id)).map((e) => e.detail)).toEqual([
      { provider: 'anthropic' },
      { provider: 'elevenlabs' },
    ])

    const deleted = await post(cookie, { intent: 'delete', provider: 'elevenlabs' })
    expect(deleted.headers.get('location')).toBe(at('status=deleted&provider=elevenlabs', 'elevenlabs'))
    expect((await getKeyStatuses(db(), user.id)).map((k) => k.provider)).toEqual(['anthropic'])
    expect((await keyEvents(user.id)).at(-1)).toEqual({ event: 'api_key.deleted', detail: { provider: 'elevenlabs' } })
  })

  it('refuses a malformed key or an Anthropic one before asking ElevenLabs', async () => {
    const { user, cookie } = await signedIn()
    const asked = vi.fn(stubs)
    for (const [key, error] of [
      ['short-key', 'shape'],
      ['a key with spaces inside it, long enough', 'shape'],
      ['x'.repeat(301), 'shape'],
      ['sk-ant-api03-a-test-key-that-is-long-enough-0001', 'anthropic'],
    ] as const) {
      const response = await post(cookie, { intent: 'save', provider: 'elevenlabs', key }, asked)
      expect(response.headers.get('location'), key).toBe(at(`error=${error}&provider=elevenlabs`, 'elevenlabs'))
    }
    expect(asked).not.toHaveBeenCalled()
    expect(await getKeyStatuses(db(), user.id)).toEqual([])
  })

  it('maps what ElevenLabs says about a key: 401 rejected, 403 permission, anything else try again; every check counts', async () => {
    const { user, cookie } = await signedIn()
    const rejected = await save(cookie, 'elevenlabs', elevenLabsKey(STUB_ELEVENLABS_KEYS.rejected))
    expect(rejected.headers.get('location')).toBe(at('error=rejected&provider=elevenlabs', 'elevenlabs'))
    const permission = await save(cookie, 'elevenlabs', elevenLabsKey(STUB_ELEVENLABS_KEYS.noVoices))
    expect(permission.headers.get('location')).toBe(at('error=permission&provider=elevenlabs', 'elevenlabs'))
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const down = await save(cookie, 'elevenlabs', elevenLabsKey(STUB_ELEVENLABS_KEYS.down))
    expect(down.headers.get('location')).toBe(at('error=unavailable&provider=elevenlabs', 'elevenlabs'))
    const logged = errors.mock.calls.join(' ')
    errors.mockRestore()
    expect(logged).toContain('elevenlabs check failed with status 500')
    expect(logged).not.toContain(elevenLabsKey(STUB_ELEVENLABS_KEYS.down))
    expect(await getKeyStatuses(db(), user.id)).toEqual([])
    expect((await keyEvents(user.id)).map((e) => [e.event, e.detail])).toEqual([
      ['api_key.rejected', { provider: 'elevenlabs', outcome: 'rejected' }],
      ['api_key.rejected', { provider: 'elevenlabs', outcome: 'permission' }],
      ['api_key.rejected', { provider: 'elevenlabs', outcome: 'unavailable' }],
    ])
  })

  it('keeps the Anthropic checks as they were', async () => {
    const { cookie } = await signedIn()
    const shape = await save(cookie, 'anthropic', 'not-a-key-at-all-but-long')
    expect(shape.headers.get('location')).toBe(at('error=shape&provider=anthropic', 'anthropic'))
    const rejected = await save(cookie, 'anthropic', 'sk-ant-api03-this-is-a-fake-key-0000')
    expect(rejected.headers.get('location')).toBe(at('error=rejected&provider=anthropic', 'anthropic'))
    const unknown = await post(cookie, { intent: 'rotate', provider: 'anthropic' })
    expect(unknown.headers.get('location')).toBe(at('error=invalid&provider=anthropic', 'anthropic'))
    const provider = await post(cookie, { intent: 'save', provider: 'openai', key: 'sk-whatever-long-enough' })
    expect(provider.headers.get('location')).toBe('/account/api-keys?error=invalid')
  })

  it('counts both providers’ changes against the one limit', async () => {
    const { user, cookie } = await signedIn()
    await spend(db(), user.id, 'api-key', API_KEY_LIMIT.max)
    const limited = await save(cookie, 'elevenlabs', elevenLabsKey())
    expect(limited.headers.get('location')).toBe(at('error=limit&provider=elevenlabs', 'elevenlabs'))
  })

  it('answers failed in the provider’s section when the database does', async () => {
    const { cookie } = await signedIn()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    await raw`alter table api_keys rename to api_keys_gone`
    try {
      const failed = await post(cookie, { intent: 'delete', provider: 'anthropic' })
      expect(failed.headers.get('location')).toBe(at('error=failed&provider=anthropic', 'anthropic'))
      expect(errors.mock.calls.map((call) => String(call[0]))).toEqual([expect.stringMatching(/^\[api keys\] /)])
    } finally {
      await raw`alter table api_keys_gone rename to api_keys`
      errors.mockRestore()
    }
  })
})

describe('the voice model for read aloud', () => {
  const origin = getConfig().appOrigin
  const cookieName = getConfig().cookieSecure ? '__Host-session' : 'session'
  const post = (cookie: string, model: string) =>
    handleApiKeys(
      new Request(`${origin}/account/api-keys`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/x-www-form-urlencoded', cookie },
        body: new URLSearchParams({ intent: 'speech-model', model }),
      }),
    )
  async function signedIn() {
    const user = await newUser()
    const token = newSessionToken()
    await createSession(db(), { tokenHash: hashToken(token), userId: user.id, ip: null, userAgent: 'test' })
    return { user, cookie: `${cookieName}=${token}` }
  }

  it('is a nullable column, read as Eleven v4 Turbo until chosen and for an id the code no longer lists', async () => {
    const [column] = await raw<{ is_nullable: string; data_type: string }[]>`
      select is_nullable, data_type from information_schema.columns
      where table_name = 'users' and column_name = 'speech_model'`
    expect(column).toEqual({ is_nullable: 'YES', data_type: 'text' })
    const user = await newUser()
    expect(await getSpeechModel(db(), user.id)).toBe('eleven_v4_turbo')
    expect(await getSpeechModel(db(), 999_999)).toBe('eleven_v4_turbo')
    await raw`update users set speech_model = 'eleven_v9_retired' where id = ${user.id}`
    expect(await getSpeechModel(db(), user.id)).toBe('eleven_v4_turbo')
  })

  it('saves a choice, audits a change but not a save that changes nothing, and refuses unknown models', async () => {
    const { user, cookie } = await signedIn()
    const saved = await post(cookie, 'eleven_v4')
    expect([saved.status, saved.headers.get('location')]).toEqual([
      303,
      '/account/api-keys?status=speech-model-saved&provider=elevenlabs#speech-model',
    ])
    expect(await getSpeechModel(db(), user.id)).toBe('eleven_v4')
    await post(cookie, 'eleven_v4')
    const events = await raw<{ detail: unknown }[]>`
      select detail from audit_events where event = 'speech_model.changed' and user_id = ${user.id}`
    expect(events.map((e) => e.detail)).toEqual([{ from: 'eleven_v4_turbo', to: 'eleven_v4' }])
    const bad = await post(cookie, 'eleven_made_up')
    expect(bad.headers.get('location')).toBe('/account/api-keys?error=invalid&provider=elevenlabs#speech-model')
    expect(await getSpeechModel(db(), user.id)).toBe('eleven_v4')
    await spend(db(), user.id, 'api-key', API_KEY_LIMIT.max)
    expect((await post(cookie, 'eleven_v4_turbo')).headers.get('location')).toContain('status=speech-model-saved')
  })

  it('answers failed when the database does', async () => {
    const { cookie } = await signedIn()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    await raw`alter table users rename column speech_model to speech_model_gone`
    try {
      const response = await post(cookie, 'eleven_v4')
      expect(response.headers.get('location')).toBe('/account/api-keys?error=failed&provider=elevenlabs#speech-model')
    } finally {
      await raw`alter table users rename column speech_model_gone to speech_model`
      errors.mockRestore()
    }
  })
})

describe('cascades', () => {
  it('deleting a user removes their sessions and keys and keeps the audit trail', async () => {
    const user = await newUser()
    await newSession(user.id)
    await saveKey(db(), user.id, 'anthropic', KEY)
    await recordEvent(db(), 'user.created', { userId: user.id })
    await raw`delete from users where id = ${user.id}`
    expect((await raw`select 1 from sessions`).count).toBe(0)
    expect((await raw`select 1 from api_keys`).count).toBe(0)
    const events = await raw<{ user_id: string | null; event: string }[]>`select user_id, event from audit_events`
    expect(events).toEqual([{ user_id: null, event: 'user.created' }])
  })
})

describe('deleting your own account', () => {
  const origin = getConfig().appOrigin
  const cookieName = getConfig().cookieSecure ? '__Host-session' : 'session'
  const PASSWORD = 'a long enough password for tests'

  async function signedIn(username = 'leaver', role: 'admin' | 'member' = 'member') {
    const user = await testUser(db(), username, await hashPassword(PASSWORD), role)
    const token = newSessionToken()
    await createSession(db(), { tokenHash: hashToken(token), userId: user.id, ip: null, userAgent: 'test' })
    return { user, cookie: `${cookieName}=${token}` }
  }

  const post = (cookie: string, current: string, headers: Record<string, string> = {}) =>
    handleAccount(
      new Request(`${origin}/account`, {
        method: 'POST',
        headers: { origin, cookie, 'content-type': 'application/x-www-form-urlencoded', ...headers },
        body: new URLSearchParams({ intent: 'delete-account', username: 'ignored', current }),
      }),
    )

  it('refuses a wrong password, and counts it towards the username’s lock', async () => {
    const { cookie } = await signedIn()
    const wrong = await post(cookie, 'not the password at all')
    expect([wrong.status, wrong.headers.get('location')]).toEqual([303, '/account?error=delete-current#delete'])
    expect(await findUserByUsername(db(), 'leaver')).not.toBeNull()
    for (let i = 0; i < 4; i++) await post(cookie, 'not the password at all')
    expect(await usernameLockedUntil(db(), 'leaver')).toBeInstanceOf(Date)
  })

  it('refuses a locked username even with the right password, and audits it', async () => {
    const { user, cookie } = await signedIn()
    for (let i = 0; i < 5; i++) await recordAttempt(db(), { username: 'leaver', ip: null, succeeded: false })
    const locked = await post(cookie, PASSWORD)
    expect(locked.headers.get('location')).toBe('/account?error=delete-current#delete')
    expect(await findUserByUsername(db(), 'leaver')).not.toBeNull()
    const [event] = await raw<{ detail: unknown }[]>`
      select detail from audit_events where event = 'login.locked' and user_id = ${user.id}`
    expect(event?.detail).toEqual({ username: 'leaver', reason: 'username locked', via: 'delete account' })
  })

  it('refuses the only enabled admin', async () => {
    const { cookie } = await signedIn('boss', 'admin')
    const refused = await post(cookie, PASSWORD)
    expect(refused.headers.get('location')).toBe('/account?error=last-admin#delete')
    expect(await findUserByUsername(db(), 'boss')).not.toBeNull()
  })

  it('deletes the account, clears the cookie and sends the reader to the sign-in page', async () => {
    await signedIn('boss', 'admin')
    const { user, cookie } = await signedIn()
    const deleted = await post(cookie, PASSWORD, { 'x-real-ip': '198.51.100.20' })
    expect([deleted.status, deleted.headers.get('location')]).toEqual([303, '/login?status=account-deleted'])
    expect(deleted.headers.get('set-cookie')).toMatch(new RegExp(`^${cookieName}=; .*Max-Age=0`))
    expect(await findUserByUsername(db(), 'leaver')).toBeNull()
    expect((await raw`select 1 from sessions where user_id = ${user.id}`).count).toBe(0)
    const [event] = await raw<{ user_id: string | null; detail: unknown }[]>`
      select user_id, detail from audit_events where event = 'user.deleted'`
    expect(event).toEqual({ user_id: null, detail: { username: 'leaver', role: 'member', via: 'account page' } })
  })
})
