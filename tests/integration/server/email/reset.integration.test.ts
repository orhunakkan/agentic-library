import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, vi } from 'vitest'
import { type Config, getConfig } from '~/server/config'
import { closeDb, getDb } from '~/server/db'
import { it, raw, resetTables } from '../../../support/server/db-test'

vi.mock('~/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/server/db')>()
  return { ...actual, getDb: vi.fn(actual.getDb) }
})

import { recordEvent } from '~/server/audit'
import { handleForgotPassword, handleResetPassword, resetPage, resetWorkSettled } from '~/server/email/actions'
import { createToken } from '~/server/email/store'
import { recordAttempt, usernameLockedUntil } from '~/server/login-attempts'
import type { CapturedMail } from '~/server/mail/capture'
import { hashPassword, verifyPassword } from '~/server/passwords'
import { RESET_ACCOUNT_LIMIT } from '~/server/rate-limit'
import { hashToken, newSessionToken } from '~/server/security'
import { createSession, findSession } from '~/server/sessions'
import { createUser, findUserById, type User } from '~/server/users'

const config = getConfig() as { -readonly [K in keyof Config]: Config[K] }
const origin = config.appOrigin
const PASSWORD = 'the reader’s own long password'
const NEW_PASSWORD = 'a brand new password for ann'
const FROM = 'Folio <no-reply@folio.test>'
const IP = '203.0.113.7'
const SENT = '/forgot-password?status=sent'
let dir = ''

afterAll(async () => {
  config.mail = null
  await closeDb()
})
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'folio-reset-'))
  config.mail = { transport: 'capture', from: FROM, dir }
})
afterEach(async () => {
  await resetWorkSettled()
  rmSync(dir, { recursive: true, force: true })
})

function mailTo(to: string): CapturedMail[] {
  return readdirSync(dir)
    .sort()
    .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')) as CapturedMail)
    .filter((m) => m.to.toLowerCase() === to.toLowerCase())
}

const tokenIn = (text: string) => /\/reset-password\?token=([A-Za-z0-9_-]{43})/.exec(text)?.[1] ?? ''

async function reader(username: string, email: string | null = `${username}@example.com`): Promise<User> {
  const user = await createUser(getDb(), username, await hashPassword(PASSWORD), 'member')
  if (email) await raw`update users set email = ${email}, email_verified_at = now() where id = ${user.id}`
  return user
}

const post = (path: string, body: Record<string, string>, headers: Record<string, string> = {}) =>
  new Request(`${origin}${path}`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': IP, ...headers },
    body: new URLSearchParams(body),
  })

const forgot = (identifier: string, headers: Record<string, string> = {}) =>
  handleForgotPassword(post('/forgot-password', { identifier }, headers))

const reset = (token: string, password = NEW_PASSWORD, confirm = password) =>
  handleResetPassword(post('/reset-password', { token, password, confirm, username: 'ignored' }))

const where = (response: Response) => [response.status, response.headers.get('location')]

const requested = async () =>
  (
    await raw<{ user_id: string | null; ip: string | null; detail: unknown }[]>`
      select user_id, host(ip) as ip, detail from audit_events where event = 'password.reset_requested' order by id`
  ).map((e) => [e.user_id === null ? null : Number(e.user_id), e.ip, e.detail])

async function resetToken(username: string, email = `${username}@example.com`): Promise<string> {
  expect(where(await forgot(username))).toEqual([303, SENT])
  await resetWorkSettled()
  return tokenIn(mailTo(email).at(-1)?.text ?? '')
}

describe('asking for a reset', () => {
  it('gives the same answer for every outcome, and mails only a real, usable address', async () => {
    const ann = await reader('ann')
    const off = await reader('off')
    await raw`update users set disabled_at = now() where id = ${off.id}`
    await reader('none', null)
    const gone = await reader('gone')
    await raw`update users set email_bounced_at = now() where id = ${gone.id}`
    const busy = await reader('busy')
    for (let i = 0; i < 3; i++)
      await createToken(getDb(), {
        userId: busy.id,
        purpose: 'reset',
        email: 'busy@example.com',
        limit: RESET_ACCOUNT_LIMIT,
      })

    const answers = []
    for (const name of ['nobody', 'off', 'none', 'gone', 'busy', 'ann', 'not a username'])
      answers.push(where(await forgot(name)))
    expect(new Set(answers.map((a) => JSON.stringify(a)))).toEqual(new Set([JSON.stringify([303, SENT])]))
    await resetWorkSettled()

    expect(readdirSync(dir)).toHaveLength(1)
    const [message] = mailTo('ann@example.com')
    expect(message).toMatchObject({ kind: 'reset', subject: 'Reset your Folio password' })
    expect(message?.text).toContain('the Folio account “ann”')
    const rows = await raw<{ user_id: string; ttl: number }[]>`
      select user_id, extract(epoch from expires_at - created_at)::int as ttl from email_tokens
      where purpose = 'reset' and used_at is null and user_id <> ${busy.id}`
    expect(rows.map((r) => [Number(r.user_id), r.ttl])).toEqual([[ann.id, 30 * 60]])
    const events = await requested()
    expect(events).toHaveLength(7)
    expect(events).toEqual(
      expect.arrayContaining([
        [null, IP, { by: 'username', outcome: 'unknown', accounts: 0 }],
        [off.id, IP, { by: 'username', outcome: 'disabled', accounts: 1 }],
        [off.id + 1, IP, { by: 'username', outcome: 'no-address', accounts: 1 }],
        [gone.id, IP, { by: 'username', outcome: 'bounced', accounts: 1 }],
        [busy.id, IP, { by: 'username', outcome: 'limited', accounts: 1 }],
        [ann.id, IP, { by: 'username', outcome: 'sent', accounts: 1 }],
      ]),
    )
    expect(events.filter((e) => e[0] === null)).toHaveLength(2)
  })

  it('sends each account that shares an address its own link, by its username', async () => {
    const ann = await reader('ann', 'family@example.com')
    const bob = await reader('bob', 'Family@Example.com')
    expect(where(await forgot('FAMILY@example.com'))).toEqual([303, SENT])
    await resetWorkSettled()
    const messages = mailTo('family@example.com')
    expect(messages.map((m) => /account “(\w+)”/.exec(m.text)?.[1]).sort()).toEqual(['ann', 'bob'])
    expect(new Set(messages.map((m) => tokenIn(m.text))).size).toBe(2)
    expect(await requested()).toEqual([[null, IP, { by: 'email', outcome: 'sent', accounts: 2 }]])
    expect([ann.id, bob.id]).toHaveLength(2)
  })

  it('refuses the 21st request in an hour from one IP, and not another IP', async () => {
    for (let i = 0; i < 20; i++)
      await recordEvent(getDb(), 'password.reset_requested', { ip: IP, detail: { by: 'username', outcome: 'unknown' } })
    expect(where(await forgot('ann'))).toEqual([303, '/forgot-password?error=limited'])
    expect(where(await forgot('ann', { 'x-real-ip': '198.51.100.1' }))).toEqual([303, SENT])
    await raw`update audit_events set at = now() - interval '61 minutes' where host(ip) = ${IP}`
    expect(where(await forgot('ann'))).toEqual([303, SENT])
  })

  it('refuses empty and overlong input and another origin, without looking anything up', async () => {
    expect(where(await forgot('   '))).toEqual([303, '/forgot-password?error=invalid'])
    expect(where(await forgot('a'.repeat(255)))).toEqual([303, '/forgot-password?error=invalid'])
    expect((await forgot('ann', { origin: 'https://evil.example' })).status).toBe(403)
    await resetWorkSettled()
    expect(await requested()).toEqual([])
  })

  it('answers at once even when the mail never goes out', async () => {
    await reader('ann')
    config.mail = { transport: 'resend', from: FROM, apiKey: 're_test', apiBase: 'https://resend.test' }
    let release = () => {}
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            release = () => resolve(Response.json({ id: 'late' }))
          }),
      ),
    )
    const answer = await Promise.race([
      forgot('ann'),
      new Promise<'timed out'>((resolve) => setTimeout(() => resolve('timed out'), 2000)),
    ])
    expect(answer === 'timed out' ? answer : where(answer)).toEqual([303, SENT])
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
    release()
  })

  it('records a send that failed, and treats a twin’s bounced address as bounced', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const ann = await reader('ann')
    config.mail = { transport: 'resend', from: FROM, apiKey: 're_test', apiBase: 'https://resend.test' }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ name: 'application_error' }, { status: 500 })),
    )
    expect(where(await forgot('ann'))).toEqual([303, SENT])
    await resetWorkSettled()
    expect((await raw`select 1 from email_tokens where used_at is null`).count).toBe(0)

    const twin = await reader('twin', 'ann@example.com')
    await raw`update users set email_bounced_at = now() where id = ${twin.id}`
    expect(where(await forgot('ann@example.com'))).toEqual([303, SENT])
    await resetWorkSettled()
    expect(await requested()).toEqual([
      [ann.id, IP, { by: 'username', outcome: 'failed', accounts: 1 }],
      [null, IP, { by: 'email', outcome: 'bounced', accounts: 2 }],
    ])
  })

  it('has no IP limit without an IP, as in local runs', async () => {
    for (let i = 0; i < 20; i++)
      await recordEvent(getDb(), 'password.reset_requested', { ip: IP, detail: { by: 'username', outcome: 'unknown' } })
    const local = new Request(`${origin}/forgot-password`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ identifier: 'ann' }),
    })
    expect(where(await handleForgotPassword(local))).toEqual([303, SENT])
  })

  it('touches no database with mail off', async () => {
    await reader('ann')
    config.mail = null
    vi.mocked(getDb).mockClear()
    expect(where(await forgot('ann'))).toEqual([303, '/forgot-password'])
    expect(where(await reset(newSessionToken()))).toEqual([303, '/reset-password'])
    expect(await resetPage(newSessionToken())).toEqual({ state: 'off' })
    expect(getDb).not.toHaveBeenCalled()
  })

  it('answers unavailable when the database is down', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(getDb).mockImplementationOnce(() => {
      throw new Error('database down')
    })
    expect(where(await forgot('ann'))).toEqual([303, '/forgot-password?error=unavailable'])
  })

  it('logs and records nothing more when the lookup fails after the answer', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await raw`alter table email_tokens rename to email_tokens_away`
    try {
      await reader('ann')
      expect(where(await forgot('ann'))).toEqual([303, SENT])
      await resetWorkSettled()
    } finally {
      await raw`alter table email_tokens_away rename to email_tokens`
    }
    expect(log.mock.calls.flat().join('\n')).toContain('[forgot password]')
    expect(await requested()).toEqual([])
  })
})

describe('the reset link', () => {
  it('shows who it is for, and opening it uses nothing', async () => {
    await reader('ann')
    const token = await resetToken('ann')
    expect(await resetPage(token)).toEqual({ state: 'ready', username: 'ann' })
    expect(await resetPage(token)).toEqual({ state: 'ready', username: 'ann' })
    expect(await resetPage('short')).toEqual({ state: 'invalid' })
    expect(await resetPage(newSessionToken())).toEqual({ state: 'invalid' })
  })

  it('sets the password, ends every session, clears the lock and tells the address, once', async () => {
    const ann = await reader('ann')
    const token = await resetToken('ann')
    const session = newSessionToken()
    await createSession(getDb(), { tokenHash: hashToken(session), userId: ann.id, ip: null, userAgent: 'test' })
    for (let i = 0; i < 5; i++) await recordAttempt(getDb(), { username: 'ann', ip: null, succeeded: false })

    expect(where(await reset(token))).toEqual([303, '/login?status=password-reset'])
    const after = await findUserById(getDb(), ann.id)
    expect(await verifyPassword(NEW_PASSWORD, after?.passwordHash ?? '')).toBe(true)
    expect(await findSession(getDb(), hashToken(session))).toBeNull()
    expect(await usernameLockedUntil(getDb(), 'ann')).toBeNull()
    const [row] = await raw<{ used_at: Date | null }[]>`select used_at from email_tokens where purpose = 'reset'`
    expect(row?.used_at).toBeInstanceOf(Date)
    const [event] = await raw<{ detail: unknown; ip: string }[]>`
      select detail, host(ip) as ip from audit_events where event = 'password.changed'`
    expect(event).toEqual({ detail: { via: 'reset link', sessionsEnded: 1 }, ip: IP })
    const notice = mailTo('ann@example.com').find((m) => m.kind === 'password-reset')
    expect(notice?.subject).toBe('Your Folio password was reset')
    expect(notice?.text).toContain('The password of the Folio account “ann” was reset on ')

    expect(where(await reset(token, 'yet another long password'))).toEqual([303, `/reset-password?token=${token}`])
    expect(await verifyPassword(NEW_PASSWORD, (await findUserById(getDb(), ann.id))?.passwordHash ?? '')).toBe(true)
  })

  it('leaves the link unused when the new password is refused', async () => {
    await reader('ann')
    const token = await resetToken('ann')
    expect(where(await reset(token, NEW_PASSWORD, 'something else entirely'))).toEqual([
      303,
      `/reset-password?token=${token}&error=mismatch`,
    ])
    expect(where(await reset(token, 'too short'))).toEqual([
      303,
      `/reset-password?token=${token}&error=policy&reason=short`,
    ])
    expect(await resetPage(token)).toEqual({ state: 'ready', username: 'ann' })
    expect(where(await reset(token))).toEqual([303, '/login?status=password-reset'])
  })

  it('stops working once expired, after any password change, a new address, disabling or a bounce', async () => {
    const cases: [string, (user: User) => Promise<unknown>][] = [
      ['expired', () => raw`update email_tokens set expires_at = now() - interval '1 second'`],
      ['changed', (u) => raw`update users set password_changed_at = now() + interval '1 second' where id = ${u.id}`],
      ['moved', (u) => raw`update users set email = 'elsewhere@example.com' where id = ${u.id}`],
      ['disabled', (u) => raw`update users set disabled_at = now() where id = ${u.id}`],
      ['bounced', (u) => raw`update users set email_bounced_at = now() where id = ${u.id}`],
    ]
    for (const [name, change] of cases) {
      await resetTables()
      const user = await reader('ann')
      const token = await resetToken('ann')
      await change(user)
      expect(await resetPage(token), name).toEqual({ state: 'invalid' })
      expect(where(await reset(token)), name).toEqual([303, `/reset-password?token=${token}`])
    }
  })

  it('takes the address case-insensitively, and refuses another origin and a malformed token', async () => {
    const ann = await reader('ann')
    const token = await resetToken('ann')
    await raw`update users set email = 'ANN@example.com' where id = ${ann.id}`
    expect(await resetPage(token)).toEqual({ state: 'ready', username: 'ann' })
    const foreign = handleResetPassword(
      post(
        '/reset-password',
        { token, password: NEW_PASSWORD, confirm: NEW_PASSWORD },
        { origin: 'https://evil.example' },
      ),
    )
    expect((await foreign).status).toBe(403)
    expect(where(await reset('not-a-token'))).toEqual([303, '/reset-password'])
  })

  it('lets only one of two posts of the same link through', async () => {
    const ann = await reader('ann')
    const token = await resetToken('ann')
    const answers = await Promise.all([reset(token, 'the first new password'), reset(token, 'the second new password')])
    expect(answers.map(where).sort()).toEqual([
      [303, '/login?status=password-reset'],
      [303, `/reset-password?token=${token}`],
    ])
    const hash = (await findUserById(getDb(), ann.id))?.passwordHash ?? ''
    expect([
      await verifyPassword('the first new password', hash),
      await verifyPassword('the second new password', hash),
    ]).toContain(true)
    expect((await raw`select 1 from audit_events where event = 'password.changed'`).count).toBe(1)
  })

  it('refuses a body that isn’t a form', async () => {
    const json = (path: string) =>
      new Request(`${origin}${path}`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: '{"identifier":"ann"}',
      })
    expect(where(await handleForgotPassword(json('/forgot-password')))).toEqual([303, '/forgot-password?error=invalid'])
    expect(where(await handleResetPassword(json('/reset-password')))).toEqual([303, '/reset-password'])
  })

  it('answers unavailable when the database fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const token = newSessionToken()
    await raw`alter table email_tokens rename to email_tokens_away`
    try {
      expect(await resetPage(token)).toEqual({ state: 'unavailable' })
      expect(where(await reset(token))).toEqual([303, `/reset-password?token=${token}&error=unavailable`])
    } finally {
      await raw`alter table email_tokens_away rename to email_tokens`
    }
  })
})
