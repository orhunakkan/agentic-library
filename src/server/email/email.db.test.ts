import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleAccount } from '~/server/account-actions'
import { type Config, getConfig } from '~/server/config'
import { closeDb, getDb } from '~/server/db'
import { confirmPage, emailSection, handleConfirmEmail } from '~/server/email/actions'
import { createToken, markBounced, pendingAddress } from '~/server/email/store'
import { recordAttempt, usernameLockedUntil } from '~/server/login-attempts'
import type { CapturedMail } from '~/server/mail/capture'
import { hashPassword } from '~/server/passwords'
import { EMAIL_VERIFY_LIMIT } from '~/server/rate-limit'
import { hashToken, newSessionToken } from '~/server/security'
import { createSession } from '~/server/sessions'
import { createUser, findUserById } from '~/server/users'
import { databaseUrl, freshDatabase } from '../testing/db'

const raw = postgres(databaseUrl, { max: 1, onnotice: () => {} })
const config = getConfig() as { -readonly [K in keyof Config]: Config[K] }
const origin = config.appOrigin
const cookieName = config.cookieSecure ? '__Host-session' : 'session'
const PASSWORD = 'the reader’s own long password'
const FROM = 'Folio <no-reply@folio.test>'
let dir = ''

beforeAll(freshDatabase)
afterAll(async () => {
  config.mail = null
  await raw.end()
  await closeDb()
})
beforeEach(async () => {
  await raw`truncate users, sessions, login_attempts, audit_events, email_tokens restart identity cascade`
  dir = mkdtempSync(join(tmpdir(), 'folio-mail-'))
  config.mail = { transport: 'capture', from: FROM, dir }
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function mailTo(to: string): CapturedMail[] {
  return readdirSync(dir)
    .sort()
    .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')) as CapturedMail)
    .filter((m) => m.to.toLowerCase() === to.toLowerCase())
}

const tokenIn = (text: string) => /\/confirm-email\?token=([A-Za-z0-9_-]{43})/.exec(text)?.[1] ?? ''

async function signedIn(username = 'ann') {
  const user = await createUser(getDb(), username, await hashPassword(PASSWORD), 'member')
  const token = newSessionToken()
  await createSession(getDb(), { tokenHash: hashToken(token), userId: user.id, ip: null, userAgent: 'test' })
  return { user, cookie: `${cookieName}=${token}` }
}

const form = (
  path: string,
  cookie: string | null,
  body: Record<string, string>,
  headers: Record<string, string> = {},
) =>
  new Request(`${origin}${path}`, {
    method: 'POST',
    headers: {
      origin,
      'content-type': 'application/x-www-form-urlencoded',
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: new URLSearchParams(body),
  })

const account = (cookie: string | null, body: Record<string, string>, headers: Record<string, string> = {}) =>
  handleAccount(form('/account', cookie, body, headers))

const add = (cookie: string, email: string, current = PASSWORD) =>
  account(cookie, { intent: 'email-add', email, current, username: 'ignored' })

const confirm = (cookie: string | null, token: string, headers: Record<string, string> = {}) =>
  handleConfirmEmail(form('/confirm-email', cookie, { token }, headers))

const page = (cookie: string | null, token: string | undefined) =>
  confirmPage(new Request(`${origin}/confirm-email`, { headers: cookie ? { cookie } : {} }), token)

const where = (response: Response) => [response.status, response.headers.get('location')]

const events = async (event: string) =>
  (await raw<{ detail: unknown }[]>`select detail from audit_events where event = ${event} order by id`).map(
    (e) => e.detail,
  )

async function confirmed(cookie: string, email: string) {
  await add(cookie, email)
  const token = tokenIn(mailTo(email).at(-1)?.text ?? '')
  expect(where(await confirm(cookie, token))).toEqual([303, '/account?status=email-confirmed#email'])
}

describe('adding an address', () => {
  it('sends a signed-out visitor to sign in', async () => {
    expect(where(await account(null, { intent: 'email-add', email: 'a@b.co' }))).toEqual([
      303,
      '/login?next=%2Faccount',
    ])
  })

  it('stores only a token hash, and mails one link whose token hashes to it', async () => {
    const { user, cookie } = await signedIn()
    expect(where(await add(cookie, ' Ann@Example.COM '))).toEqual([303, '/account?status=email-sent#email'])
    const [message, ...more] = mailTo('ann@example.com')
    expect(more).toEqual([])
    expect(message).toMatchObject({ from: FROM, kind: 'confirm', subject: 'Confirm your email address for Folio' })
    const token = tokenIn(message?.text ?? '')
    const rows = await raw<{ token_hash: Buffer; email: string; purpose: string; ttl: number }[]>`
      select token_hash, email, purpose, extract(epoch from expires_at - created_at)::int as ttl from email_tokens`
    expect(rows).toEqual([
      { token_hash: hashToken(token), email: 'Ann@example.com', purpose: 'verify', ttl: 24 * 60 * 60 },
    ])
    expect(JSON.stringify(await raw`select * from email_tokens`)).not.toContain(token)
    expect((await findUserById(getDb(), user.id))?.email).toBeNull()
    expect(await events('email.verification_sent')).toEqual([{ resend: false }])
    expect(await emailSection(user.id)).toEqual({
      confirmed: null,
      bounced: false,
      pending: { id: 1, email: 'Ann@example.com', bounced: false },
    })
  })

  it('refuses a malformed address and a wrong password, which counts towards the lock', async () => {
    const { cookie } = await signedIn()
    expect(where(await add(cookie, 'not an address'))).toEqual([303, '/account?error=email-invalid#email'])
    expect(where(await add(cookie, 'ann@example.com', 'wrong password'))).toEqual([
      303,
      '/account?error=email-current#email',
    ])
    for (let i = 0; i < 4; i++) await add(cookie, 'ann@example.com', 'wrong password')
    expect(await usernameLockedUntil(getDb(), 'ann')).toBeInstanceOf(Date)
    expect(where(await add(cookie, 'ann@example.com'))).toEqual([303, '/account?error=email-current#email'])
    expect(await events('login.locked')).toEqual([{ username: 'ann', reason: 'username locked', via: 'email' }])
    expect(readdirSync(dir)).toEqual([])
  })

  it('refuses the address already confirmed, in any case', async () => {
    const { cookie } = await signedIn()
    await confirmed(cookie, 'ann@example.com')
    expect(where(await add(cookie, 'ANN@example.com'))).toEqual([303, '/account?error=email-same#email'])
  })

  it('allows 5 links an hour, resends included', async () => {
    const { user, cookie } = await signedIn()
    await add(cookie, 'one@example.com')
    for (let i = 0; i < 3; i++)
      expect(where(await account(cookie, { intent: 'email-resend' }))).toEqual([
        303,
        '/account?status=email-sent#email',
      ])
    await add(cookie, 'two@example.com')
    expect(where(await add(cookie, 'three@example.com'))).toEqual([303, '/account?error=email-limit#email'])
    expect(where(await account(cookie, { intent: 'email-resend' }))).toEqual([303, '/account?error=email-limit#email'])
    expect(mailTo('three@example.com')).toEqual([])
    await raw`update email_tokens set created_at = now() - interval '61 minutes' where user_id = ${user.id}`
    expect(where(await add(cookie, 'three@example.com'))).toEqual([303, '/account?status=email-sent#email'])
    expect(await events('email.verification_sent')).toEqual([
      { resend: false },
      { resend: true },
      { resend: true },
      { resend: true },
      { resend: false },
      { resend: false },
    ])
  })

  it('replaces the pending address, and the older link stops working', async () => {
    const { user, cookie } = await signedIn()
    await add(cookie, 'first@example.com')
    const first = tokenIn(mailTo('first@example.com')[0]?.text ?? '')
    await add(cookie, 'second@example.com')
    expect((await pendingAddress(getDb(), user.id))?.email).toBe('second@example.com')
    expect(await page(cookie, first)).toEqual({ state: 'invalid' })
    expect(where(await confirm(cookie, first))).toEqual([303, `/confirm-email?token=${first}`])
    expect((await findUserById(getDb(), user.id))?.email).toBeNull()
  })

  it('reads Resend’s 429 as busy and 422 as invalid, and keeps the earlier pending address', async () => {
    const { user, cookie } = await signedIn()
    await add(cookie, 'kept@example.com')
    config.mail = { transport: 'resend', from: FROM, apiKey: 're_test', apiBase: 'https://resend.test' }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const answers = [
      { status: 429, name: 'daily_quota_exceeded' },
      { status: 422, name: 'validation_error' },
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const { status, name } = answers.shift() ?? { status: 500, name: 'application_error' }
        return Response.json({ statusCode: status, name, message: 'no' }, { status })
      }),
    )
    expect(where(await add(cookie, 'busy@example.com'))).toEqual([303, '/account?error=email-busy#email'])
    expect(where(await add(cookie, 'refused@example.com'))).toEqual([303, '/account?error=email-invalid#email'])
    expect(where(await add(cookie, 'down@example.com'))).toEqual([303, '/account?error=email-failed#email'])
    expect((await pendingAddress(getDb(), user.id))?.email).toBe('kept@example.com')
    expect(await events('email.verification_sent')).toEqual([{ resend: false }])
  })

  it('does nothing with mail off', async () => {
    const { user, cookie } = await signedIn()
    config.mail = null
    expect(where(await add(cookie, 'ann@example.com'))).toEqual([303, '/account#email'])
    expect(where(await account(cookie, { intent: 'email-remove' }))).toEqual([303, '/account#email'])
    expect(await emailSection(user.id)).toBeNull()
    expect((await raw`select 1 from email_tokens`).count).toBe(0)
    expect((await raw`select 1 from login_attempts`).count).toBe(0)
  })
})

describe('confirming', () => {
  it('only checks the token on the page, whoever opens it', async () => {
    const { cookie } = await signedIn()
    const other = await signedIn('bob')
    await add(cookie, 'ann@example.com')
    const token = tokenIn(mailTo('ann@example.com')[0]?.text ?? '')
    expect(await page(cookie, token)).toEqual({ state: 'ready', email: 'ann@example.com' })
    expect(await page(null, token)).toEqual({ state: 'signed-out' })
    expect(await page(other.cookie, token)).toEqual({ state: 'other-account' })
    expect(await page(cookie, newSessionToken())).toEqual({ state: 'invalid' })
    expect(await page(cookie, 'short')).toEqual({ state: 'invalid' })
    expect(await page(cookie, undefined)).toEqual({ state: 'invalid' })
    const [row] = await raw<{ used_at: Date | null }[]>`select used_at from email_tokens`
    expect(row?.used_at).toBeNull()
    config.mail = null
    expect(await page(cookie, token)).toEqual({ state: 'off' })
  })

  it('refuses another origin, another account and a signed-out post', async () => {
    const { user, cookie } = await signedIn()
    const other = await signedIn('bob')
    await add(cookie, 'ann@example.com')
    const token = tokenIn(mailTo('ann@example.com')[0]?.text ?? '')
    expect((await confirm(cookie, token, { origin: 'https://evil.example' })).status).toBe(403)
    expect(where(await confirm(null, token))).toEqual([
      303,
      `/login?next=${encodeURIComponent(`/confirm-email?token=${token}`)}`,
    ])
    expect(where(await confirm(other.cookie, token))).toEqual([303, `/confirm-email?token=${token}`])
    expect(where(await confirm(cookie, 'not-a-token'))).toEqual([303, '/confirm-email'])
    expect((await findUserById(getDb(), user.id))?.email).toBeNull()
    expect((await findUserById(getDb(), other.user.id))?.email).toBeNull()
  })

  it('refuses an expired link and a used one', async () => {
    const { user, cookie } = await signedIn()
    await add(cookie, 'ann@example.com')
    const token = tokenIn(mailTo('ann@example.com')[0]?.text ?? '')
    await raw`update email_tokens set expires_at = now() - interval '1 second'`
    expect(where(await confirm(cookie, token))).toEqual([303, `/confirm-email?token=${token}`])
    await raw`update email_tokens set expires_at = now() + interval '1 hour'`
    expect(where(await confirm(cookie, token))).toEqual([303, '/account?status=email-confirmed#email'])
    expect(where(await confirm(cookie, token))).toEqual([303, `/confirm-email?token=${token}`])
    expect(await events('email.verified')).toEqual([{ replaced: false }])
    expect((await findUserById(getDb(), user.id))?.email).toBe('ann@example.com')
  })

  it('sets the address, clears a bounce, uses up the account’s other links and tells the old address', async () => {
    const { user, cookie } = await signedIn()
    await confirmed(cookie, 'old@example.com')
    await add(cookie, 'nora@example.org')
    const token = tokenIn(mailTo('nora@example.org')[0]?.text ?? '')
    const reset = await createToken(getDb(), {
      userId: user.id,
      purpose: 'reset',
      email: 'old@example.com',
      limit: EMAIL_VERIFY_LIMIT,
    })
    expect(where(await confirm(cookie, token))).toEqual([303, '/account?status=email-confirmed#email'])
    const after = await findUserById(getDb(), user.id)
    expect(after).toMatchObject({ email: 'nora@example.org', emailBouncedAt: null })
    expect(after?.emailVerifiedAt).toBeInstanceOf(Date)
    expect((await raw`select 1 from email_tokens where used_at is null`).count).toBe(0)
    expect(reset).not.toBe('limit')
    expect(await events('email.verified')).toEqual([{ replaced: false }, { replaced: true }])
    const [notice, ...more] = mailTo('old@example.com').filter((m) => m.kind === 'address-changed')
    expect(more).toEqual([])
    expect(notice?.subject).toBe('Your Folio email address was changed')
    expect(notice?.text).toContain('to n…@example.org on ')
    expect(notice?.text).not.toContain('nora')
  })

  it('confirms a bounced address again, which clears the mark, and tells nobody', async () => {
    const { user, cookie } = await signedIn()
    await confirmed(cookie, 'ann@example.com')
    await markBounced(getDb(), 'ann@example.com', 'bounce')
    expect(await emailSection(user.id)).toMatchObject({ bounced: true })
    await confirmed(cookie, 'ann@example.com')
    expect((await findUserById(getDb(), user.id))?.emailBouncedAt).toBeNull()
    expect(mailTo('ann@example.com').map((m) => m.kind)).toEqual(['confirm', 'confirm'])
  })

  it('lets only one of two posts of the same link through', async () => {
    const { cookie } = await signedIn()
    await add(cookie, 'ann@example.com')
    const token = tokenIn(mailTo('ann@example.com')[0]?.text ?? '')
    const answers = await Promise.all([confirm(cookie, token), confirm(cookie, token)])
    expect(answers.map(where).sort()).toEqual([
      [303, '/account?status=email-confirmed#email'],
      [303, `/confirm-email?token=${token}`],
    ])
    expect(await events('email.verified')).toEqual([{ replaced: false }])
  })

  it('sends no notice to an old address that bounced', async () => {
    const { cookie } = await signedIn()
    await confirmed(cookie, 'old@example.com')
    await markBounced(getDb(), 'old@example.com', 'complaint')
    await confirmed(cookie, 'new@example.com')
    expect(mailTo('old@example.com').map((m) => m.kind)).toEqual(['confirm'])
  })
})

describe('resending and removing', () => {
  it('resends to the pending address only, and not once it bounced', async () => {
    const { cookie } = await signedIn()
    expect(where(await account(cookie, { intent: 'email-resend' }))).toEqual([303, '/account#email'])
    await add(cookie, 'ann@example.com')
    expect(where(await account(cookie, { intent: 'email-resend' }))).toEqual([303, '/account?status=email-sent#email'])
    expect(mailTo('ann@example.com')).toHaveLength(2)
    await markBounced(getDb(), 'ann@example.com', 'bounce')
    expect(where(await account(cookie, { intent: 'email-resend' }))).toEqual([303, '/account#email'])
    expect(mailTo('ann@example.com')).toHaveLength(2)
  })

  it('cancels a pending change and keeps the confirmed address', async () => {
    const { user, cookie } = await signedIn()
    await confirmed(cookie, 'ann@example.com')
    await add(cookie, 'other@example.com')
    expect(where(await account(cookie, { intent: 'email-remove', pending: '1' }))).toEqual([303, '/account#email'])
    expect(await emailSection(user.id)).toMatchObject({
      confirmed: { email: 'ann@example.com' },
      pending: null,
    })
    expect(await events('email.removed')).toEqual([{ pending: true }])
  })

  it('removes the confirmed address and every unused link', async () => {
    const { user, cookie } = await signedIn()
    await confirmed(cookie, 'ann@example.com')
    await add(cookie, 'other@example.com')
    expect(where(await account(cookie, { intent: 'email-remove' }))).toEqual([
      303,
      '/account?status=email-removed#email',
    ])
    expect(await emailSection(user.id)).toEqual({ confirmed: null, bounced: false, pending: null })
    expect(await findUserById(getDb(), user.id)).toMatchObject({ email: null, emailVerifiedAt: null })
    await account(cookie, { intent: 'email-remove' })
    expect(await events('email.removed')).toEqual([{}])
  })

  it('answers unavailable when the database fails', async () => {
    const { cookie } = await signedIn()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await raw`alter table email_tokens rename to email_tokens_away`
    try {
      expect(where(await add(cookie, 'ann@example.com'))).toEqual([303, '/account?error=unavailable'])
      expect(await page(cookie, newSessionToken())).toEqual({ state: 'unavailable' })
      expect(where(await confirm(cookie, newSessionToken()))).toEqual([303, '/account?error=unavailable'])
    } finally {
      await raw`alter table email_tokens_away rename to email_tokens`
    }
  })
})

it('keeps the recorded failures under the lock limit when the password is right', async () => {
  const { cookie } = await signedIn()
  await recordAttempt(getDb(), { username: 'ann', ip: null, succeeded: false })
  expect(where(await add(cookie, 'ann@example.com'))).toEqual([303, '/account?status=email-sent#email'])
  expect(await usernameLockedUntil(getDb(), 'ann')).toBeNull()
})
