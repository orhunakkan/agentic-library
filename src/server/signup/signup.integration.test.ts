import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, vi } from 'vitest'
import { type Config, getConfig } from '~/server/config'
import { closeDb, getDb } from '~/server/db'
import { it, raw } from '../testing/db-test'

vi.mock('~/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/server/db')>()
  return { ...actual, getDb: vi.fn(actual.getDb) }
})

import { handleLogin } from '~/server/account-actions'
import { deleteAccount } from '~/server/admin/store'
import type { CapturedMail } from '~/server/mail/capture'
import { svixSignature } from '~/server/mail/signature'
import { handleMailEvent } from '~/server/mail/webhook'
import { hashPassword } from '~/server/passwords'
import { hashToken, newSessionToken } from '~/server/security'
import { createSession, findSession } from '~/server/sessions'
import { handleSignup, signupPage, signupWorkSettled } from '~/server/signup/actions'
import { createAccountFromToken, createInvite, createSignupToken } from '~/server/signup/store'
import { createUser, findUserByUsername, type User } from '~/server/users'

const config = getConfig() as { -readonly [K in keyof Config]: Config[K] }
const origin = config.appOrigin
const cookieName = config.cookieSecure ? '__Host-session' : 'session'
const PASSWORD = 'a long new password for ann'
const FROM = 'Folio <no-reply@folio.test>'
const IP = '203.0.113.9'
const SENT = '/signup?status=sent'
let dir = ''

afterAll(async () => {
  config.mail = null
  config.signup = 'invite'
  config.mailWebhookKey = null
  await closeDb()
})
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'folio-signup-'))
  config.mail = { transport: 'capture', from: FROM, dir }
  config.signup = 'open'
})
afterEach(async () => {
  await signupWorkSettled()
  rmSync(dir, { recursive: true, force: true })
})

function mailTo(to: string): CapturedMail[] {
  return readdirSync(dir)
    .sort()
    .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')) as CapturedMail)
    .filter((m) => m.to.toLowerCase() === to.toLowerCase())
}

const tokenIn = (text: string) => /\/signup\?token=([A-Za-z0-9_-]{43})/.exec(text)?.[1] ?? ''

const post = (body: Record<string, string>, headers: Record<string, string> = {}) =>
  new Request(`${origin}/signup`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': IP, ...headers },
    body: new URLSearchParams(body),
  })

const ask = (email: string, headers: Record<string, string> = {}, extra: Record<string, string> = {}) =>
  handleSignup(post({ email, website: '', ...extra }, headers))

const finish = (
  token: string,
  username: string,
  {
    password = PASSWORD,
    confirm = password,
    headers = {},
  }: { password?: string; confirm?: string; headers?: Record<string, string> } = {},
) => handleSignup(post({ token, username, password, confirm }, headers))

const where = (response: Response) => [response.status, response.headers.get('location')]

const events = async (event: string) =>
  (
    await raw<{ user_id: string | null; ip: string | null; detail: unknown }[]>`
      select user_id, host(ip) as ip, detail from audit_events where event = ${event} order by id`
  ).map((e) => [e.user_id === null ? null : Number(e.user_id), e.ip, e.detail])

const tokenRows = () =>
  raw<
    {
      kind: string
      email: string | null
      used: boolean
      used_by: string | null
      attempts: number
      bounced: boolean
    }[]
  >`
    select kind, email, used_at is not null as used, used_by, attempts, bounced_at is not null as bounced
    from signup_tokens order by created_at, id`

async function linkFor(email: string): Promise<string> {
  expect(where(await ask(email))).toEqual([303, SENT])
  await signupWorkSettled()
  return tokenIn(mailTo(email).at(-1)?.text ?? '')
}

async function account(username: string, email: string | null = null, role: 'admin' | 'member' = 'member') {
  const user = await createUser(getDb(), username, await hashPassword(`${username}’s own long password`), role)
  if (email) await raw`update users set email = ${email}, email_verified_at = now() where id = ${user.id}`
  return user
}

async function signedIn(user: User) {
  const token = newSessionToken()
  await createSession(getDb(), { tokenHash: hashToken(token), userId: user.id, ip: null, userAgent: 'test' })
  return `${cookieName}=${token}`
}

async function inviteBy(admin: User, note: string | null = null): Promise<string> {
  const made = await createInvite(getDb(), { by: admin.id, note })
  if (made === 'quota') throw new Error('quota')
  return made.token
}

const page = (token: string | undefined, cookie?: string) =>
  signupPage(new Request(`${origin}/signup`, { headers: cookie ? { cookie } : {} }), token)

const fillDaily = (n: number) => raw`
  insert into signup_tokens (token_hash, kind, email, expires_at)
  select sha256(convert_to('fill-' || i, 'UTF8')), 'email', 'fill-' || i || '@example.org', now() + interval '1 day'
  from generate_series(1, ${n}) i`

describe('asking for a link', () => {
  it('does nothing unless sign-up is open', async () => {
    for (const mode of ['off', 'invite'] as const) {
      config.signup = mode
      expect(where(await ask('ann@example.com'))).toEqual([303, '/signup'])
    }
    await signupWorkSettled()
    expect(await tokenRows()).toEqual([])
    expect((await raw`select 1 from audit_events`).count).toBe(0)
    expect(mailTo('ann@example.com')).toEqual([])
  })

  it('answers sent, then makes one link and mails it, without the address in the trail', async () => {
    expect(where(await ask(' Ann@Example.com '))).toEqual([303, SENT])
    await signupWorkSettled()
    expect(await tokenRows()).toMatchObject([{ kind: 'email', email: 'Ann@example.com', used: false, attempts: 0 }])
    const [mail] = mailTo('ann@example.com')
    expect(mail).toMatchObject({ kind: 'signup', subject: 'Finish signing up for Folio' })
    expect(tokenIn(mail?.text ?? '')).toHaveLength(43)
    expect(await events('signup.requested')).toEqual([[null, IP, { outcome: 'sent', existing: 0 }]])
    expect(JSON.stringify(await raw`select detail from audit_events`)).not.toMatch(/ann/i)
  })

  it('answers sent for an address with accounts, a bounced one, one over its limit and a honeypot', async () => {
    await account('ann', 'shared@example.com')
    await account('bob', 'Shared@example.com')
    const off = await account('off', 'shared@example.com')
    await raw`update users set disabled_at = now() where id = ${off.id}`
    const gone = await account('gone', 'gone@example.com')
    await raw`update users set email_bounced_at = now() where id = ${gone.id}`
    for (let i = 0; i < 3; i++) await createSignupToken(getDb(), { email: 'busy@example.com' })

    expect(where(await ask('shared@example.com'))).toEqual([303, SENT])
    expect(where(await ask('gone@example.com'))).toEqual([303, SENT])
    expect(where(await ask('busy@example.com'))).toEqual([303, SENT])
    expect(where(await ask('bot@example.com', {}, { website: 'https://spam.example' }))).toEqual([303, SENT])
    await signupWorkSettled()

    const outcomes = (await events('signup.requested')).map((e) => (e[2] as { outcome: string }).outcome)
    expect(outcomes.sort()).toEqual(['address-limited', 'bounced', 'existing', 'honeypot'])
    expect(await events('signup.requested')).toContainEqual([null, IP, { outcome: 'existing', existing: 2 }])
    const [shared] = mailTo('shared@example.com')
    expect(shared?.text).toContain('the Folio accounts “ann” and “bob”')
    expect(shared?.text).not.toContain('off')
    expect(mailTo('gone@example.com')).toEqual([])
    expect(mailTo('busy@example.com')).toEqual([])
    expect(mailTo('bot@example.com')).toEqual([])
    expect((await raw`select 1 from signup_tokens where email = 'bot@example.com'`).count).toBe(0)
  })

  it('names at most 5 accounts sharing an address', async () => {
    for (const name of ['aa1', 'aa2', 'aa3', 'aa4', 'aa5', 'aa6']) await account(name, 'family@example.com')
    await linkFor('family@example.com')
    const text = mailTo('family@example.com')[0]?.text ?? ''
    expect(text).toContain('“aa1”, “aa2”, “aa3”, “aa4” and “aa5”')
    expect(text).not.toContain('aa6')
  })

  it('refuses what isn’t an address, before anything is stored', async () => {
    expect(where(await ask('not an address'))).toEqual([303, '/signup?error=invalid'])
    expect(where(await handleSignup(post({})))).toEqual([303, '/signup?error=invalid'])
    await signupWorkSettled()
    expect(await tokenRows()).toEqual([])
  })

  it('refuses a signed-in visitor and another origin', async () => {
    const cookie = await signedIn(await account('ann'))
    expect(where(await ask('new@example.com', { cookie }))).toEqual([303, '/signup'])
    expect((await ask('new@example.com', { origin: 'https://evil.example' })).status).toBe(403)
    await signupWorkSettled()
    expect(await tokenRows()).toEqual([])
  })

  it('limits one IP to 5 requests an hour, and a missing IP not at all', async () => {
    for (let i = 0; i < 5; i++) expect(where(await ask(`r${i}@example.com`))).toEqual([303, SENT])
    await signupWorkSettled()
    expect(where(await ask('r6@example.com'))).toEqual([303, '/signup?error=limited'])
    const local = new Request(`${origin}/signup`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: 'local@example.com' }),
    })
    expect(where(await handleSignup(local))).toEqual([303, SENT])
  })

  it('stops at 30 links a day for the whole site', async () => {
    await fillDaily(30)
    expect(where(await ask('late@example.com'))).toEqual([303, '/signup?error=busy'])
  })

  it('counts the daily cap again when the link is made, under the lock', async () => {
    await fillDaily(29)
    const made = await Promise.all(
      Array.from({ length: 5 }, (_, i) => createSignupToken(getDb(), { email: `race${i}@example.com` })),
    )
    expect(made.filter((m) => typeof m === 'object')).toHaveLength(1)
    expect(made.filter((m) => m === 'busy')).toHaveLength(4)
    expect((await raw`select 1 from signup_tokens where kind = 'email'`).count).toBe(30)
  })

  it('cancels the link when the mail can’t be sent', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    config.mail = { transport: 'resend', from: FROM, apiKey: 're_test', apiBase: 'https://resend.test' }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ name: 'application_error' }, { status: 500 })),
    )
    expect(where(await ask('ann@example.com'))).toEqual([303, SENT])
    await signupWorkSettled()
    expect(await tokenRows()).toMatchObject([{ used: true }])
    expect(await events('signup.requested')).toEqual([[null, IP, { outcome: 'failed', existing: 0 }]])
  })

  it('reads a body that isn’t a form as no address', async () => {
    const plain = new Request(`${origin}/signup`, {
      method: 'POST',
      headers: { origin, 'content-type': 'text/plain' },
      body: 'email=ann@example.com',
    })
    expect(where(await handleSignup(plain))).toEqual([303, '/signup?error=invalid'])
  })

  it('still answers sent when the work after the answer fails, and logs it', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(getDb)
      .mockReturnValueOnce(getDb())
      .mockImplementationOnce(() => {
        throw new Error('connect ECONNREFUSED')
      })
    expect(where(await ask('ann@example.com'))).toEqual([303, SENT])
    await signupWorkSettled()
    expect(log.mock.calls.map((call) => String(call[0]))).toEqual([expect.stringMatching(/^\[sign-up request\] /)])
    expect(await tokenRows()).toEqual([])
  })

  it('answers unavailable when the database is down', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(getDb).mockImplementationOnce(() => {
      throw new Error('connect ECONNREFUSED')
    })
    expect(where(await ask('ann@example.com'))).toEqual([303, '/signup?error=unavailable'])
  })
})

describe('the link’s page', () => {
  it('never changes a row, attempts included', async () => {
    const token = await linkFor('ann@example.com')
    const before = await tokenRows()
    for (let i = 0; i < 3; i++) await page(token)
    expect(await tokenRows()).toEqual(before)
  })

  it('shows the address for a sign-up link, and none for an invite', async () => {
    const admin = await account('orhun', null, 'admin')
    expect(await page(await linkFor('Ann@example.com'))).toEqual({
      state: 'ready',
      kind: 'email',
      email: 'Ann@example.com',
    })
    expect(await page(await inviteBy(admin, 'for Ann'))).toEqual({ state: 'ready', kind: 'invite', email: null })
  })

  it('says invalid for a link that is unknown, expired, used, revoked, bounced or refused 10 times', async () => {
    expect(await page('x'.repeat(43))).toEqual({ state: 'invalid' })
    expect(await page('not a token')).toEqual({ state: 'invalid' })
    const tokens: string[] = []
    for (let i = 1; i <= 5; i++) tokens.push(await linkFor(`a${i}@example.com`))
    await raw`update signup_tokens set expires_at = now() - interval '1 second' where email = 'a1@example.com'`
    await raw`update signup_tokens set used_at = now() where email = 'a2@example.com'`
    await raw`update signup_tokens set revoked_at = now() where email = 'a3@example.com'`
    await raw`update signup_tokens set bounced_at = now() where email = 'a4@example.com'`
    await raw`update signup_tokens set attempts = 10 where email = 'a5@example.com'`
    for (const token of tokens) expect(await page(token)).toEqual({ state: 'invalid' })
  })

  it('says closed for a sign-up link when sign-up isn’t open, and for any link when it’s off', async () => {
    const admin = await account('orhun', null, 'admin')
    const link = await linkFor('ann@example.com')
    const invite = await inviteBy(admin)
    config.signup = 'invite'
    expect(await page(link)).toEqual({ state: 'closed' })
    expect(await page(invite)).toMatchObject({ state: 'ready' })
    config.signup = 'off'
    expect(await page(link)).toEqual({ state: 'closed' })
    expect(await page(invite)).toEqual({ state: 'closed' })
  })

  it('without a token, says what the mode offers', async () => {
    expect(await page(undefined)).toEqual({ state: 'request' })
    config.signup = 'invite'
    expect(await page(undefined)).toEqual({ state: 'invite-only' })
    config.signup = 'off'
    expect(await page(undefined)).toEqual({ state: 'off' })
  })

  it('tells a signed-in visitor so, with or without a token', async () => {
    const cookie = await signedIn(await account('ann'))
    expect(await page(undefined, cookie)).toEqual({ state: 'signed-in', username: 'ann' })
    expect(await page(await linkFor('new@example.com'), cookie)).toEqual({ state: 'signed-in', username: 'ann' })
  })

  it('says unavailable when the database fails', async () => {
    const token = await linkFor('ann@example.com')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(getDb).mockImplementationOnce(() => {
      throw new Error('connect ECONNREFUSED')
    })
    expect(await page(token)).toEqual({ state: 'unavailable' })
  })
})

describe('finishing', () => {
  it('makes a member with the confirmed address, signs them in and uses the link up', async () => {
    const token = await linkFor('Ann@example.com')
    const answer = await finish(token, ' Ann ')
    expect(where(answer)).toEqual([303, '/account?status=welcome'])
    const cookie = answer.headers.get('set-cookie') ?? ''
    expect(cookie).toMatch(new RegExp(`^${cookieName}=[A-Za-z0-9_-]{43}; Path=/; Max-Age=\\d+; HttpOnly; SameSite=Lax`))
    const session = await findSession(getDb(), hashToken(/=([^;]+)/.exec(cookie)?.[1] ?? ''))
    expect(session).toMatchObject({ username: 'ann', role: 'member' })

    const user = await findUserByUsername(getDb(), 'ann')
    expect(user).toMatchObject({ role: 'member', email: 'Ann@example.com' })
    expect(user?.emailVerifiedAt).toBeInstanceOf(Date)
    expect(await tokenRows()).toMatchObject([{ used: true, used_by: String(user?.id) }])
    expect(await events('user.created')).toEqual([[user?.id, IP, { via: 'sign-up', role: 'member' }]])
    expect(await events('login.succeeded')).toEqual([[user?.id, IP, { via: 'sign-up' }]])
    expect(where(await finish(token, 'ann2'))).toEqual([303, `/signup?token=${token}`])
  })

  it('makes a member without an address from an invite, and records who invited them', async () => {
    const admin = await account('orhun', null, 'admin')
    const token = await inviteBy(admin, 'for Bob')
    expect(where(await finish(token, 'bob'))).toEqual([303, '/account?status=welcome'])
    const bob = await findUserByUsername(getDb(), 'bob')
    expect(bob).toMatchObject({ role: 'member', email: null, emailVerifiedAt: null })
    expect(await events('user.created')).toEqual([[bob?.id, IP, { via: 'invite', role: 'member', by: admin.id }]])
  })

  it('makes an account that signs in with its password', async () => {
    await finish(await linkFor('ann@example.com'), 'ann')
    const login = new Request(`${origin}/login`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: 'ann', password: PASSWORD, next: '/library' }),
    })
    expect(where(await handleLogin(login))).toEqual([303, '/library'])
  })

  it('counts each refusal against the link, records it, and keeps the link until the 10th', async () => {
    await account('ann')
    const token = await linkFor('new@example.com')
    const back = (query: string) => `/signup?token=${token}&${query}`
    const refusals: [Response, string][] = [
      [await finish(token, 'a b'), back('error=username&username=a+b')],
      [await finish(token, 'ANN'), back('error=taken&username=ann')],
      [await finish(token, 'admin'), back('error=taken&username=admin')],
      [
        await finish(token, 'newbie', { password: 'fourteen chars' }),
        back('error=policy&reason=short&username=newbie'),
      ],
      [
        await finish(token, 'a-long-name-of-15', { password: 'A-LONG-NAME-OF-15' }),
        back('error=policy&reason=username&username=a-long-name-of-15'),
      ],
      [await finish(token, 'newbie', { confirm: 'something else entirely' }), back('error=mismatch&username=newbie')],
    ]
    for (const [answer, location] of refusals) {
      expect(where(answer)).toEqual([303, location])
      expect(location).not.toContain('password=')
    }
    expect((await tokenRows())[0]).toMatchObject({ used: false, attempts: 6 })
    expect((await events('signup.refused')).map((e) => e[2])).toEqual([
      { kind: 'email', reason: 'username', attempts: 1 },
      { kind: 'email', reason: 'taken', attempts: 2 },
      { kind: 'email', reason: 'taken', attempts: 3 },
      { kind: 'email', reason: 'policy', attempts: 4 },
      { kind: 'email', reason: 'policy', attempts: 5 },
      { kind: 'email', reason: 'mismatch', attempts: 6 },
    ])
    for (let i = 7; i <= 10; i++) await finish(token, 'a b')
    expect(await page(token)).toEqual({ state: 'invalid' })
    expect(where(await finish(token, 'newbie'))).toEqual([303, `/signup?token=${token}`])
    expect(await findUserByUsername(getDb(), 'newbie')).toBeNull()
  })

  it('makes one account when the same link is finished twice at once', async () => {
    const token = await linkFor('ann@example.com')
    const passwordHash = await hashPassword(PASSWORD)
    const results = await Promise.all(
      ['one', 'two'].map((username) =>
        createAccountFromToken(getDb(), { tokenHash: hashToken(token), username, passwordHash, ip: null }),
      ),
    )
    expect(results.map((r) => r.outcome).sort()).toEqual(['created', 'gone'])
    expect((await raw`select 1 from users`).count).toBe(1)
  })

  it('makes one account when two links take the same username at once', async () => {
    const tokens = [await linkFor('a@example.com'), await linkFor('b@example.com')]
    const passwordHash = await hashPassword(PASSWORD)
    const results = await Promise.all(
      tokens.map((token) =>
        createAccountFromToken(getDb(), { tokenHash: hashToken(token), username: 'ann', passwordHash, ip: null }),
      ),
    )
    expect(results.map((r) => r.outcome).sort()).toEqual(['created', 'taken'])
    expect((await raw`select 1 from users`).count).toBe(1)
    expect((await tokenRows()).map((t) => [t.used, t.attempts]).sort()).toEqual([
      [false, 1],
      [true, 0],
    ])
  })

  it('makes nothing for a signed-in visitor, another origin, or a sign-up link once the mode changes', async () => {
    const cookie = await signedIn(await account('ann'))
    const token = await linkFor('new@example.com')
    const page = `/signup?token=${token}`
    expect(where(await finish(token, 'newbie', { headers: { cookie } }))).toEqual([303, page])
    expect((await finish(token, 'newbie', { headers: { origin: 'https://evil.example' } })).status).toBe(403)
    config.signup = 'invite'
    expect(where(await finish(token, 'newbie'))).toEqual([303, page])
    config.signup = 'off'
    expect(where(await finish(token, 'newbie'))).toEqual([303, page])
    expect(await findUserByUsername(getDb(), 'newbie')).toBeNull()
    expect(await tokenRows()).toMatchObject([{ used: false, attempts: 0 }])
  })

  it('sends a malformed token back to /signup, and an over-long field to unavailable', async () => {
    expect(where(await finish('nope', 'ann'))).toEqual([303, '/signup'])
    const token = await linkFor('ann@example.com')
    expect(where(await finish(token, 'ann', { password: 'x'.repeat(1025) }))).toEqual([
      303,
      `/signup?token=${token}&error=unavailable`,
    ])
  })

  it('answers unavailable when the database fails', async () => {
    const token = await linkFor('ann@example.com')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(getDb).mockImplementationOnce(() => {
      throw new Error('connect ECONNREFUSED')
    })
    expect(where(await finish(token, 'ann'))).toEqual([303, `/signup?token=${token}&error=unavailable&username=ann`])
  })
})

describe('what deleting and sweeping do to links', () => {
  it('deletes an admin’s pending invites with them, and keeps a used one when its account goes', async () => {
    const admin = await account('orhun', null, 'admin')
    await account('other', null, 'admin')
    await inviteBy(admin, 'pending')
    await finish(await inviteBy(admin, 'used'), 'bob')
    const bob = await findUserByUsername(getDb(), 'bob')
    await deleteAccount(getDb(), bob?.id ?? 0, { detail: { via: 'users page' } })
    expect(await raw`select note, used_by from signup_tokens order by note`).toEqual([
      { note: 'pending', used_by: null },
      { note: 'used', used_by: null },
    ])
    await deleteAccount(getDb(), admin.id, { detail: { via: 'users page' } })
    expect(await tokenRows()).toEqual([])
  })

  it('sweeps sign-up links after 7 days and ended invites after 30, when a link is made', async () => {
    const admin = await account('orhun', null, 'admin')
    for (const note of ['old-used', 'old-expired', 'old-revoked', 'recent-used', 'pending']) await inviteBy(admin, note)
    await raw`update signup_tokens set used_at = now() - interval '31 days' where note = 'old-used'`
    await raw`update signup_tokens set expires_at = now() - interval '31 days' where note = 'old-expired'`
    await raw`update signup_tokens set revoked_at = now() - interval '31 days' where note = 'old-revoked'`
    await raw`update signup_tokens set used_at = now() - interval '29 days' where note = 'recent-used'`
    await fillDaily(2)
    await raw`update signup_tokens set created_at = now() - interval '8 days' where email = 'fill-1@example.org'`
    await createSignupToken(getDb(), { email: 'new@example.com' })
    expect(
      (await raw<{ label: string }[]>`select coalesce(note, email) as label from signup_tokens order by 1`).map(
        (r) => r.label,
      ),
    ).toEqual(['fill-2@example.org', 'new@example.com', 'pending', 'recent-used'])
  })
})

describe('bounces', () => {
  const KEY = Buffer.alloc(24, 5)

  it('mark pending sign-up links to the address, and the next request for it is not mailed', async () => {
    config.mailWebhookKey = KEY
    const token = await linkFor('ann@example.com')
    const now = new Date()
    const timestamp = String(Math.floor(now.getTime() / 1000))
    const fixture = JSON.parse(readFileSync(new URL('../mail/fixtures/email.bounced.json', import.meta.url), 'utf8'))
    const body = JSON.stringify({ ...fixture, data: { ...fixture.data, to: ['ann@example.com'] } })
    const answer = await handleMailEvent(
      new Request(`${origin}/mail/events`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'svix-id': 'msg_test',
          'svix-timestamp': timestamp,
          'svix-signature': `v1,${svixSignature(KEY, 'msg_test', timestamp, body)}`,
        },
        body,
      }),
      now,
    )
    expect(answer.status).toBe(200)
    expect(await tokenRows()).toMatchObject([{ bounced: true }])
    expect(await page(token)).toEqual({ state: 'invalid' })

    expect(where(await ask('ANN@example.com'))).toEqual([303, SENT])
    await signupWorkSettled()
    expect((await events('signup.requested')).at(-1)).toEqual([null, IP, { outcome: 'bounced', existing: 0 }])
    expect(mailTo('ann@example.com')).toHaveLength(1)
  })
})
