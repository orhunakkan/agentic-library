import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, vi } from 'vitest'
import { handleAccount } from '~/server/account-actions'
import { readAccount } from '~/server/account-data/store'
import { handleUserChange } from '~/server/admin/actions'
import { type Config, getConfig } from '~/server/config'
import { checkCurrentPassword } from '~/server/current-password'
import { closeDb, getDb, type Pool } from '~/server/db'
import { databaseUrl } from '../testing/db'
import { it, raw } from '../testing/db-test'

vi.mock('~/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/server/db')>()
  return { ...actual, getDb: vi.fn(actual.getDb) }
})

import { handleResetPassword } from '~/server/email/actions'
import { createToken } from '~/server/email/store'
import { recordAttempt, usernameLockedUntil } from '~/server/login-attempts'
import type { CapturedMail } from '~/server/mail/capture'
import { handleAddOptions, handleNewPasskey, passkeyMailSettled, passkeyName } from '~/server/passkeys/actions'
import { handleSignIn, handleSignInChallenge } from '~/server/passkeys/sign-in'
import {
  addPasskey,
  hashChallenge,
  listPasskeys,
  makeChallenge,
  sweepChallenges,
  takeChallenge,
} from '~/server/passkeys/store'
import { hashPassword } from '~/server/passwords'
import { RESET_ACCOUNT_LIMIT } from '~/server/rate-limit'
import { hashToken, newSessionToken } from '~/server/security'
import { createSession, findSession } from '~/server/sessions'
import { createUser, type Role, type User } from '~/server/users'
import {
  type AuthenticationCredentialJSON,
  type CreationOptionsJSON,
  MAX_PASSKEYS,
  type RegistrationCredentialJSON,
  type RequestOptionsJSON,
} from '~/shared/passkeys/passkeys'
import { SoftAuthenticator, strayKey } from '../testing/authenticator'
import { toPasskeyView } from './view'

const config = getConfig() as { -readonly [K in keyof Config]: Config[K] }
const origin = config.appOrigin
const cookieName = config.cookieSecure ? '__Host-session' : 'session'
const PASSWORD = 'the reader’s own long password'
const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
let dir = ''
let hash = ''

beforeAll(async () => {
  hash = await hashPassword(PASSWORD)
})
afterAll(async () => {
  config.mail = null
  await closeDb()
})
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'folio-mail-'))
  config.mail = { transport: 'capture', from: 'Folio <no-reply@folio.test>', dir }
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function mailTo(to: string): CapturedMail[] {
  return readdirSync(dir)
    .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')) as CapturedMail)
    .filter((m) => m.to === to)
}

async function signedIn(username = 'ann', role: Role = 'member'): Promise<{ user: User; cookie: string }> {
  const user = await createUser(getDb(), username, hash, role)
  const token = newSessionToken()
  await createSession(getDb(), { tokenHash: hashToken(token), userId: user.id, ip: null, userAgent: 'test' })
  return { user, cookie: `${cookieName}=${token}` }
}

const post = (path: string, cookie: string | null, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${origin}${path}`, {
    method: 'POST',
    headers: {
      origin,
      'content-type': 'application/json',
      'user-agent': CHROME_MAC,
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

const answer = async (response: Response) => [response.status, await response.json()]

const askOptions = (cookie: string | null, password = PASSWORD, headers: Record<string, string> = {}) =>
  handleAddOptions(post('/account/passkeys/options', cookie, { password }, headers))

async function optionsFor(cookie: string): Promise<CreationOptionsJSON> {
  const response = await askOptions(cookie)
  expect(response.status).toBe(200)
  return ((await response.json()) as { options: CreationOptionsJSON }).options
}

const submit = (cookie: string | null, credential: RegistrationCredentialJSON, headers: Record<string, string> = {}) =>
  handleNewPasskey(post('/account/passkeys/new', cookie, { credential }, headers))

const events = async (event: string) =>
  (
    await raw<{ detail: Record<string, unknown> }[]>`select detail from audit_events where event = ${event} order by id`
  ).map((e) => e.detail)

async function added(cookie: string, authenticator = new SoftAuthenticator()) {
  const options = await optionsFor(cookie)
  const response = await submit(cookie, authenticator.register(options, { origin }))
  expect(response.status).toBe(200)
  return { authenticator, options, body: (await response.json()) as { passkey: { id: string } } }
}

async function fill(userId: number, count = MAX_PASSKEYS) {
  await raw`
    insert into passkeys (user_id, credential_id, public_key, backed_up, name)
    select ${userId}, int4send(n), '\\x00'::bytea, false, 'Filler' from generate_series(1, ${count}) n`
}

describe('asking to add a passkey', () => {
  it('refuses a signed-out visitor', async () => {
    expect(await answer(await askOptions(null))).toEqual([401, { error: 'signed_out' }])
  })

  it('refuses a body that isn’t the password', async () => {
    const { cookie } = await signedIn()
    const send = (body: unknown, headers = {}) =>
      handleAddOptions(post('/account/passkeys/options', cookie, body, headers))
    expect(await answer(await send({ password: PASSWORD, extra: 1 }))).toEqual([400, { error: 'invalid' }])
    expect(await answer(await send('not json'))).toEqual([400, { error: 'invalid' }])
  })

  it('needs the current password, which counts towards the username’s lock', async () => {
    const { cookie } = await signedIn()
    expect(await answer(await askOptions(cookie, 'wrong'))).toEqual([400, { error: 'password' }])
    for (let i = 0; i < 4; i++) await askOptions(cookie, 'wrong')
    expect(await usernameLockedUntil(getDb(), 'ann')).not.toBeNull()
    expect(await answer(await askOptions(cookie))).toEqual([400, { error: 'password' }])
    expect(await events('login.locked')).toEqual([{ username: 'ann', reason: 'username locked', via: 'passkey' }])
  })

  it('answers create() options for a discoverable passkey that leaves out the ones the account has', async () => {
    const { user, cookie } = await signedIn()
    const first = await optionsFor(cookie)
    expect(first.rp).toEqual({ name: 'Folio', id: new URL(origin).hostname })
    expect(first.user.name).toBe('ann')
    expect(first.excludeCredentials).toEqual([])
    const [row] = await raw<{ webauthn_user_id: Buffer }[]>`select webauthn_user_id from users where id = ${user.id}`
    expect(row?.webauthn_user_id.toString('base64url')).toBe(first.user.id)

    const { authenticator } = await added(cookie)
    const second = await optionsFor(cookie)
    expect(second.user.id).toBe(first.user.id)
    expect(second.excludeCredentials).toEqual([
      { id: authenticator.passkeys[0]?.id.toString('base64url'), type: 'public-key', transports: ['internal'] },
    ])
  })

  it('refuses an account that has 10 already', async () => {
    const { user, cookie } = await signedIn()
    await fill(user.id)
    expect(await answer(await askOptions(cookie))).toEqual([409, { error: 'quota', max: 10 }])
  })
})

describe('adding a passkey', () => {
  it('stores it, audits it and names it after the browser', async () => {
    const { user, cookie } = await signedIn()
    const { body } = await added(cookie)
    expect(body.passkey).toEqual({
      id: expect.any(String),
      name: 'Chrome on macOS',
      createdAt: expect.any(String),
      lastUsedAt: null,
      backedUp: false,
    })
    const [row] = await listPasskeys(getDb(), user.id)
    expect(row).toMatchObject({ id: body.passkey.id, signCount: 0, transports: ['internal'], backedUp: false })
    expect(await events('passkey.added')).toEqual([{ passkey: body.passkey.id, backedUp: false }])
  })

  it('refuses a signed-out visitor and a malformed credential', async () => {
    const { cookie } = await signedIn()
    const credential = new SoftAuthenticator().register(await optionsFor(cookie), { origin })
    expect(await answer(await submit(null, credential))).toEqual([401, { error: 'signed_out' }])
    const broken = { ...credential, rawId: 'different' }
    expect(await answer(await submit(cookie, broken))).toEqual([400, { error: 'invalid' }])
  })

  it('is `expired` without this account’s live register challenge', async () => {
    const { user, cookie } = await signedIn()
    const other = await signedIn('bob')
    const authenticator = new SoftAuthenticator()
    const options = await optionsFor(cookie)
    const expectExpired = async (credential: RegistrationCredentialJSON, who = cookie) =>
      expect(await answer(await submit(who, credential))).toEqual([400, { error: 'expired' }])

    await expectExpired(
      authenticator.register(options, { origin, challenge: Buffer.alloc(32, 9).toString('base64url') }),
    )
    await expectExpired(authenticator.register(options, { origin }), other.cookie)
    const signIn = await makeChallenge(getDb(), { kind: 'sign-in', userId: null, ip: null })
    await expectExpired(authenticator.register(options, { origin, challenge: signIn.toString('base64url') }))
    await raw`update passkey_challenges set expires_at = now() - interval '1 second' where user_id = ${user.id}`
    await expectExpired(authenticator.register(options, { origin }))
  })

  it('uses a challenge once, and a new one replaces the earlier', async () => {
    const { cookie } = await signedIn()
    const authenticator = new SoftAuthenticator()
    const first = await optionsFor(cookie)
    await optionsFor(cookie)
    expect(await answer(await submit(cookie, authenticator.register(first, { origin })))).toEqual([
      400,
      { error: 'expired' },
    ])
    const third = await optionsFor(cookie)
    expect((await submit(cookie, authenticator.register(third, { origin }))).status).toBe(200)
    expect(await answer(await submit(cookie, authenticator.register(third, { origin })))).toEqual([
      400,
      { error: 'expired' },
    ])
  })

  it('is `refused` for another origin, another RP ID or a user who wasn’t verified, and audits why', async () => {
    const { user, cookie } = await signedIn()
    const authenticator = new SoftAuthenticator()
    for (const ceremony of [
      { origin: 'https://evil.example' },
      { origin, rpId: 'evil.example' },
      { origin, verified: false },
    ]) {
      const credential = authenticator.register(await optionsFor(cookie), ceremony)
      expect(await answer(await submit(cookie, credential))).toEqual([400, { error: 'refused' }])
    }
    expect(await events('passkey.refused')).toEqual([
      { reason: 'origin' },
      { reason: 'rp id' },
      { reason: 'user verification' },
    ])
    expect(await listPasskeys(getDb(), user.id)).toEqual([])
  })

  it('is `taken` for a credential another account has', async () => {
    const { cookie } = await signedIn()
    const bob = await signedIn('bob')
    const credential = new SoftAuthenticator().register(await optionsFor(cookie), { origin })
    await addPasskey(getDb(), bob.user.id, {
      credentialId: Buffer.from(credential.id, 'base64url'),
      publicKey: Buffer.alloc(1),
      signCount: 0,
      transports: [],
      backedUp: false,
      name: 'Bob’s',
    })
    expect(await answer(await submit(cookie, credential))).toEqual([409, { error: 'taken' }])
  })

  it('is `quota` when the account filled up after asking', async () => {
    const { user, cookie } = await signedIn()
    const credential = new SoftAuthenticator().register(await optionsFor(cookie), { origin })
    await fill(user.id)
    expect(await answer(await submit(cookie, credential))).toEqual([409, { error: 'quota', max: 10 }])
  })
})

describe('the mail about a new passkey', () => {
  const confirm = (userId: number, email: string, bounced = false) =>
    raw`update users set email = ${email}, email_verified_at = now(),
      email_bounced_at = ${bounced ? new Date() : null} where id = ${userId}`

  it('goes to a confirmed address after the answer', async () => {
    const { user, cookie } = await signedIn()
    await confirm(user.id, 'ann@example.com')
    await added(cookie)
    await passkeyMailSettled()
    const [mail] = mailTo('ann@example.com')
    expect(mail?.subject).toBe('A passkey was added to your Folio account')
    expect(mail?.text).toContain('A passkey named “Chrome on macOS” was added to your Folio account “ann”')
  })

  it('isn’t sent to a bounced address, without an address, or with mail off', async () => {
    const ann = await signedIn()
    await confirm(ann.user.id, 'ann@example.com', true)
    await added(ann.cookie)
    const bob = await signedIn('bob')
    await added(bob.cookie)
    await passkeyMailSettled()
    expect(readdirSync(dir)).toEqual([])
    config.mail = null
    const cy = await signedIn('cyd')
    await confirm(cy.user.id, 'cy@example.com')
    await added(cy.cookie)
    await passkeyMailSettled()
    expect(readdirSync(dir)).toEqual([])
  })
})

describe('the store', () => {
  it('sweeps challenges older than an hour', async () => {
    const challenge = await makeChallenge(getDb(), { kind: 'sign-in', userId: null, ip: '203.0.113.9' })
    await raw`update passkey_challenges set created_at = now() - interval '61 minutes'`
    await sweepChallenges(getDb())
    expect(await takeChallenge(getDb(), hashChallenge(challenge), 'sign-in', null)).toBe(false)
    expect(await raw`select 1 from passkey_challenges`).toHaveLength(0)
  })

  it('cascades both tables when the account is deleted', async () => {
    const { user, cookie } = await signedIn()
    await added(cookie)
    await optionsFor(cookie)
    await raw`delete from users where id = ${user.id}`
    expect(await raw`select 1 from passkeys`).toHaveLength(0)
    expect(await raw`select 1 from passkey_challenges`).toHaveLength(0)
  })

  it('names a passkey “Passkey” when the browser can’t be told', () => {
    expect(passkeyName(null)).toBe('Passkey')
    expect(passkeyName('curl/8')).toBe('Passkey')
    expect(passkeyName(CHROME_MAC)).toBe('Chrome on macOS')
  })
})

const IP = '203.0.113.5'

const challengeRequest = (headers: Record<string, string> = {}, body?: string) =>
  handleSignInChallenge(
    new Request(`${origin}/passkeys/challenge`, { method: 'POST', headers: { origin, ...headers }, body }),
  )

async function serverSignInOptions(headers: Record<string, string> = {}): Promise<RequestOptionsJSON> {
  const response = await challengeRequest(headers)
  expect(response.status).toBe(200)
  return ((await response.json()) as { options: RequestOptionsJSON }).options
}

const signIn = (credential: AuthenticationCredentialJSON, extra: Record<string, unknown> = {}, headers = {}) =>
  handleSignIn(post('/passkeys/sign-in', null, { credential, ...extra }, headers))

async function withPasskey(username = 'ann') {
  const { user, cookie } = await signedIn(username)
  const { authenticator } = await added(cookie)
  await raw`delete from sessions`
  return { user, authenticator }
}

const assertion = async (
  authenticator: SoftAuthenticator,
  ceremony: Parameters<SoftAuthenticator['assert']>[1] = { origin },
) => authenticator.assert(await serverSignInOptions(), ceremony)

const failures = async () => (await events('login.failed')).map((d) => d.reason)

describe('signing in with a passkey', () => {
  it('signs in, records the use and goes to a same-site next', async () => {
    const { user, authenticator } = await withPasskey()
    const response = await signIn(await assertion(authenticator), { next: '/account' }, { 'x-real-ip': IP })
    expect(await answer(response.clone())).toEqual([200, { next: '/account' }])
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const token = /session=([^;]+)/.exec(response.headers.get('set-cookie') ?? '')?.[1] ?? ''
    expect((await findSession(getDb(), hashToken(token)))?.userId).toBe(user.id)
    const [row] = await listPasskeys(getDb(), user.id)
    expect(row?.signCount).toBe(1)
    expect(row?.lastUsedAt).toBeInstanceOf(Date)
    expect(await events('login.succeeded')).toEqual([{ via: 'passkey' }])
    const [attempt] = await raw<
      { username: string; succeeded: boolean }[]
    >`select username, succeeded from login_attempts where username = ''`
    expect(attempt).toEqual({ username: '', succeeded: true })
  })

  it('sends an outside next, or none, to the library', async () => {
    const { authenticator } = await withPasskey()
    expect(await answer(await signIn(await assertion(authenticator), { next: 'https://evil.example/x' }))).toEqual([
      200,
      { next: '/library' },
    ])
    expect(await answer(await signIn(await assertion(authenticator)))).toEqual([200, { next: '/library' }])
  })

  it('accepts a synced passkey’s counter of 0 every time', async () => {
    const { authenticator } = await withPasskey()
    for (let i = 0; i < 2; i++)
      expect((await signIn(await assertion(authenticator, { origin, signCount: 0 }))).status).toBe(200)
  })

  it('refuses another origin and a malformed body', async () => {
    const { authenticator } = await withPasskey()
    const credential = await assertion(authenticator)
    expect((await signIn(credential, {}, { origin: 'https://evil.example' })).status).toBe(403)
    expect(await answer(await signIn(credential, { password: 'x' }))).toEqual([400, { error: 'invalid' }])
    expect((await signIn(credential, {}, { 'content-type': 'text/plain' })).status).toBe(415)
    expect((await challengeRequest({ origin: 'https://evil.example' })).status).toBe(403)
    expect(await answer(await challengeRequest({}, 'x'.repeat(2000)))).toEqual([413, { error: 'invalid' }])
  })

  it('is one `refused` for every reason, each audited', async () => {
    const { user, authenticator } = await withPasskey()
    const refused = async (credential: AuthenticationCredentialJSON) =>
      expect(await answer(await signIn(credential))).toEqual([401, { error: 'refused' }])

    const forged = await assertion(authenticator, { origin, signWith: strayKey() })
    await refused(forged)
    await refused(forged)
    await refused(await assertion(authenticator, { origin, userHandle: Buffer.alloc(32, 3).toString('base64url') }))
    await refused(await assertion(authenticator, { origin, userHandle: null }))
    await raw`update passkeys set sign_count = 10`
    await refused(await assertion(authenticator, { origin, signCount: 5 }))
    await raw`update passkeys set sign_count = 0`
    await raw`update users set disabled_at = now() where id = ${user.id}`
    await refused(await assertion(authenticator))
    await raw`delete from passkeys`
    await refused(await assertion(authenticator))

    expect(await failures()).toEqual([
      'signature',
      'challenge',
      'user handle',
      'user handle',
      'counter',
      'disabled',
      'unknown credential',
    ])
    const [first] = await events('login.failed')
    expect(first).toEqual({ username: 'ann', reason: 'signature', via: 'passkey' })
    expect(await raw`select 1 from sessions`).toHaveLength(0)
  })

  it('refuses an expired challenge and a register challenge', async () => {
    const { user, authenticator } = await withPasskey()
    const options = await serverSignInOptions()
    await raw`update passkey_challenges set expires_at = now() - interval '1 second'`
    expect((await signIn(authenticator.assert(options, { origin }))).status).toBe(401)
    const register = await makeChallenge(getDb(), { kind: 'register', userId: user.id, ip: null })
    const credential = authenticator.assert(options, { origin, challenge: register.toString('base64url') })
    expect((await signIn(credential)).status).toBe(401)
    expect(await failures()).toEqual(['challenge', 'challenge'])
  })

  it('works while the username is locked by wrong passwords', async () => {
    const { authenticator } = await withPasskey()
    for (let i = 0; i < 5; i++) await recordAttempt(getDb(), { username: 'ann', ip: IP, succeeded: false })
    expect(await usernameLockedUntil(getDb(), 'ann')).not.toBeNull()
    expect((await signIn(await assertion(authenticator), {}, { 'x-real-ip': IP })).status).toBe(200)
  })

  it('stops at an IP blocked by password failures, which passkey failures count towards', async () => {
    const { authenticator } = await withPasskey()
    for (let i = 0; i < 30; i++) await recordAttempt(getDb(), { username: `name-${i}`, ip: IP, succeeded: false })
    const ip = { 'x-real-ip': IP }
    expect(await answer(await signIn(await assertion(authenticator), {}, ip))).toEqual([429, { error: 'limited' }])
    expect(await events('login.locked')).toEqual([{ reason: 'ip blocked', via: 'passkey' }])

    await raw`delete from login_attempts`
    const forged = await assertion(authenticator, { origin, signWith: strayKey() })
    for (let i = 0; i < 30; i++) expect((await signIn(forged, {}, ip)).status).toBe(401)
    expect((await signIn(await assertion(authenticator), {}, ip)).status).toBe(429)
    expect((await signIn(await assertion(authenticator), {}, { 'x-real-ip': '198.51.100.1' })).status).toBe(200)
  })

  it('limits sign-in challenges to 30 per IP in 15 minutes', async () => {
    const ip = { 'x-real-ip': IP }
    for (let i = 0; i < 30; i++) expect((await challengeRequest(ip)).status).toBe(200)
    expect(await answer(await challengeRequest(ip))).toEqual([429, { error: 'limited' }])
    expect((await challengeRequest({ 'x-real-ip': '198.51.100.1' })).status).toBe(200)
  })

  it('answers `unavailable` when the database fails, and logs no body', async () => {
    const { authenticator } = await withPasskey()
    const credential = await assertion(authenticator)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = (() => {
      throw new Error('the database went away')
    }) as unknown as Pool
    vi.mocked(getDb).mockReturnValueOnce(broken)
    expect(await answer(await signIn(credential))).toEqual([503, { error: 'unavailable' }])
    vi.mocked(getDb).mockReturnValueOnce(broken)
    expect(await answer(await challengeRequest())).toEqual([503, { error: 'unavailable' }])
    const logged = errors.mock.calls.map((call) => String(call[0])).join('\n')
    expect(logged).toContain('passkey sign-in')
    expect(logged).not.toContain(credential.response.signature)
  })
})

describe('the account handlers when the database fails', () => {
  it('answer `failed`', async () => {
    const { cookie } = await signedIn()
    const credential = new SoftAuthenticator().register(await optionsFor(cookie), { origin })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = (() => {
      throw new Error('the database went away')
    }) as unknown as Pool
    const real = getDb()
    vi.mocked(getDb).mockReturnValueOnce(real).mockReturnValueOnce(broken)
    expect(await answer(await askOptions(cookie))).toEqual([500, { error: 'failed' }])
    vi.mocked(getDb).mockReturnValueOnce(real).mockReturnValueOnce(broken)
    expect(await answer(await submit(cookie, credential))).toEqual([500, { error: 'failed' }])
  })
})

const form = (path: string, cookie: string | null, body: Record<string, string>) =>
  new Request(`${origin}${path}`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) },
    body: new URLSearchParams(body),
  })

const where = (response: Response) => [response.status, response.headers.get('location')]

describe('removing a passkey', () => {
  it('removes the account’s own, and audits it', async () => {
    const { user, cookie } = await signedIn()
    const { body } = await added(cookie)
    const response = await handleAccount(
      form('/account', cookie, { intent: 'passkey-remove', passkey: body.passkey.id }),
    )
    expect(where(response)).toEqual([303, '/account?status=passkey-removed#passkeys'])
    expect(await listPasskeys(getDb(), user.id)).toEqual([])
    expect(await events('passkey.removed')).toEqual([{ via: 'account' }])
  })

  it('gives the same answer, and changes nothing, for another account’s passkey or a malformed id', async () => {
    const ann = await signedIn()
    const { body } = await added(ann.cookie)
    const bob = await signedIn('bob')
    for (const passkey of [body.passkey.id, 'not-a-uuid', '', '6f1c0000-0000-4000-8000-000000000000']) {
      const response = await handleAccount(form('/account', bob.cookie, { intent: 'passkey-remove', passkey }))
      expect(where(response)).toEqual([303, '/account?status=passkey-removed#passkeys'])
    }
    expect(await listPasskeys(getDb(), ann.user.id)).toHaveLength(1)
    expect(await events('passkey.removed')).toEqual([])
  })
})

describe('setting a password without the old one', () => {
  async function twoAccounts() {
    const ann = await signedIn()
    await added(ann.cookie)
    await added(ann.cookie)
    const bob = await signedIn('bob')
    await added(bob.cookie)
    return { ann, bob }
  }

  it('from a reset link removes every passkey', async () => {
    const { ann, bob } = await twoAccounts()
    await raw`update users set email = 'ann@example.com', email_verified_at = now(),
      password_changed_at = now() - interval '1 minute' where id = ${ann.user.id}`
    const issued = await createToken(getDb(), {
      userId: ann.user.id,
      purpose: 'reset',
      email: 'ann@example.com',
      limit: RESET_ACCOUNT_LIMIT,
    })
    if (issued === 'limit') throw new Error('limit')
    const password = 'a brand new long password'
    const response = await handleResetPassword(
      form('/reset-password', null, { token: issued.token, password, confirm: password }),
    )
    expect(where(response)).toEqual([303, '/login?status=password-reset'])
    expect(await listPasskeys(getDb(), ann.user.id)).toEqual([])
    expect(await listPasskeys(getDb(), bob.user.id)).toHaveLength(1)
    expect(await events('passkey.removed')).toEqual([{ via: 'reset link', count: 2 }])
  })

  it('from the Users page removes every passkey', async () => {
    const { ann } = await twoAccounts()
    const admin = await signedIn('root', 'admin')
    const response = await handleUserChange(
      post('/account/users/ann', admin.cookie, { intent: 'reset-password' }),
      'ann',
    )
    expect(response.status).toBe(200)
    expect(await listPasskeys(getDb(), ann.user.id)).toEqual([])
    expect(await events('passkey.removed')).toEqual([{ via: 'users page', by: admin.user.id, count: 2 }])
  })

  it('with users.ts set-password removes every passkey', async () => {
    const { ann } = await twoAccounts()
    const { execFileSync } = await import('node:child_process')
    const out = execFileSync(process.execPath, ['scripts/db/users.ts', 'set-password', 'ann'], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      encoding: 'utf8',
    })
    expect(out).toContain('2 passkey(s) removed.')
    expect(await listPasskeys(getDb(), ann.user.id)).toEqual([])
    expect(await events('passkey.removed')).toEqual([expect.objectContaining({ via: 'users script', count: 2 })])
  })

  it('isn’t what Change password does: knowing the old one keeps them', async () => {
    const { ann } = await twoAccounts()
    const password = 'a brand new long password'
    const response = await handleAccount(
      form('/account', ann.cookie, { intent: 'change-password', current: PASSWORD, password, confirm: password }),
    )
    expect(where(response)).toEqual([303, '/account?status=password-changed'])
    expect(await listPasskeys(getDb(), ann.user.id)).toHaveLength(2)
    expect(await events('passkey.removed')).toEqual([])
  })
})

describe('Download your data', () => {
  it('lists passkeys without their credential ids, keys or counters', async () => {
    const { user, cookie } = await signedIn()
    await added(cookie)
    const data = await readAccount(getDb(), user.id)
    expect(data?.passkeys).toEqual([
      {
        name: 'Chrome on macOS',
        createdAt: expect.any(Date),
        lastUsedAt: null,
        backedUp: false,
        transports: ['internal'],
      },
    ])
  })
})

describe('checkCurrentPassword', () => {
  it('refuses an overlong password and an account that is gone, and marks a right one a success', async () => {
    const { user } = await signedIn()
    const session = {
      userId: user.id,
      username: 'ann',
      role: 'member' as const,
      expiresAt: new Date(),
    }
    expect(await checkCurrentPassword(getDb(), session, 'x'.repeat(1025), null, 'passkey')).toBe(false)
    expect(await checkCurrentPassword(getDb(), session, PASSWORD, null, 'passkey')).toBe(true)
    expect(await checkCurrentPassword(getDb(), { ...session, userId: user.id + 99 }, PASSWORD, null, 'passkey')).toBe(
      false,
    )
    const attempts = await raw<{ succeeded: boolean }[]>`select succeeded from login_attempts order by id`
    expect(attempts.map((a) => a.succeeded)).toEqual([false, true, false])
  })
})

describe('toPasskeyView', () => {
  it('gives the browser the name, dates and backup state, and nothing else', () => {
    const view = toPasskeyView({
      id: 'p1',
      credentialId: Buffer.from('secret id'),
      publicKey: Buffer.from('secret key'),
      signCount: 7,
      transports: ['usb'],
      backedUp: true,
      name: 'YubiKey',
      createdAt: new Date('2026-11-18T10:00:00Z'),
      lastUsedAt: new Date('2026-11-19T10:00:00Z'),
    })
    expect(view).toEqual({
      id: 'p1',
      name: 'YubiKey',
      createdAt: '2026-11-18T10:00:00.000Z',
      lastUsedAt: '2026-11-19T10:00:00.000Z',
      backedUp: true,
    })
  })
})

describe('what runs after the answer', () => {
  it('logs a mail that couldn’t be looked up, and the passkey stays added', async () => {
    const { user, cookie } = await signedIn()
    const credential = new SoftAuthenticator().register(await optionsFor(cookie), { origin })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = (() => {
      throw new Error('the database went away')
    }) as unknown as Pool
    const real = getDb()
    vi.mocked(getDb).mockReturnValueOnce(real).mockReturnValueOnce(real).mockReturnValueOnce(broken)
    expect((await submit(cookie, credential)).status).toBe(200)
    await passkeyMailSettled()
    expect(errors.mock.calls.map((call) => String(call[0])).join('\n')).toContain('passkey mail')
    expect(await listPasskeys(getDb(), user.id)).toHaveLength(1)
  })

  it('logs a sweep that failed after a sign-in, which still signs in', async () => {
    const { authenticator } = await withPasskey()
    const credential = await assertion(authenticator)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const real = getDb()
    const sweepsFail = new Proxy(real, {
      apply(target, self, args: unknown[]) {
        const strings = args[0]
        if (Array.isArray(strings) && /^\s*delete from/.test(strings[0]) && strings.join('').includes('interval'))
          return Promise.reject(new Error('sweep failed'))
        return Reflect.apply(target, self, args)
      },
    })
    vi.mocked(getDb).mockReturnValueOnce(sweepsFail)
    expect((await signIn(credential)).status).toBe(200)
    await vi.waitFor(() => expect(errors.mock.calls.map((call) => String(call[0])).join('\n')).toContain('sweep'))
  })
})
