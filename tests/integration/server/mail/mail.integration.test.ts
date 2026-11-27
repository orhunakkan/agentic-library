import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, vi } from 'vitest'
import { type Config, getConfig } from '~/server/config'
import { closeDb, getDb } from '~/server/db'
import { createToken, pendingAddress } from '~/server/email/store'
import { isMarkedBounced, mailAvailable, sendMail } from '~/server/mail/mail'
import type { OutgoingMail } from '~/server/mail/resend'
import { svixSignature } from '~/server/mail/signature'
import { handleMailEvent, MAX_EVENT_BYTES } from '~/server/mail/webhook'
import { EMAIL_VERIFY_LIMIT } from '~/server/rate-limit'
import { createUser, findUserById } from '~/server/users'
import { it, raw } from '../../../support/server/db-test'

const config = getConfig() as { -readonly [K in keyof Config]: Config[K] }
const KEY = Buffer.alloc(24, 5)
const NOW = new Date('2026-11-06T12:00:00Z')
const SECONDS = String(NOW.getTime() / 1000)
let dir = ''

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../../fixtures/mail/${name}.json`, import.meta.url), 'utf8')) as {
    type: string
    data: Record<string, unknown>
  }
const to = (name: string, ...addresses: string[]) => {
  const event = fixture(name)
  return JSON.stringify({ ...event, data: { ...event.data, to: addresses } })
}

function post(body: string, { key = KEY, timestamp = SECONDS, headers = {} as Record<string, string> } = {}) {
  return new Request('http://localhost/mail/events', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'svix-id': 'msg_test',
      'svix-timestamp': timestamp,
      'svix-signature': `v1,${svixSignature(key, 'msg_test', timestamp, body)}`,
      ...headers,
    },
    body,
  })
}

const status = async (request: Request) => (await handleMailEvent(request, NOW)).status

afterAll(async () => {
  config.mail = null
  config.mailWebhookKey = null
  await closeDb()
})
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'folio-mail-'))
  config.mail = { transport: 'capture', from: 'Folio <no-reply@folio.test>', dir }
  config.mailWebhookKey = KEY
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const withAddress = async (username: string, email: string | null) => {
  const user = await createUser(getDb(), username, 'hash', 'member')
  if (email) await raw`update users set email = ${email}, email_verified_at = now() where id = ${user.id}`
  return user
}

const bouncedEvents = async () =>
  (
    await raw<{ user_id: string; detail: unknown }[]>`
      select user_id, detail from audit_events where event = 'email.bounced' order by user_id`
  ).map((e) => [Number(e.user_id), e.detail])

describe('the webhook’s checks', () => {
  it('answers 404 without a signing secret, or with mail off', async () => {
    const body = to('email.bounced', 'ann@example.com')
    config.mailWebhookKey = null
    expect(await status(post(body))).toBe(404)
    config.mailWebhookKey = KEY
    config.mail = null
    expect(await status(post(body))).toBe(404)
  })

  it('refuses a bad signature, a stale timestamp and missing headers with 401', async () => {
    const body = to('email.bounced', 'ann@example.com')
    expect(await status(post(body, { key: Buffer.alloc(24, 6) }))).toBe(401)
    expect(await status(post(body, { timestamp: String(Number(SECONDS) - 301) }))).toBe(401)
    expect(await status(post(body, { timestamp: String(Number(SECONDS) + 301) }))).toBe(401)
    expect(await status(post(body, { headers: { 'svix-signature': '' } }))).toBe(401)
    const changed = post(body)
    const tampered = new Request(changed, { body: body.replace('ann@', 'bob@') })
    expect(await status(tampered)).toBe(401)
  })

  it('refuses a body over 16 KB with 413, declared or not', async () => {
    const big = JSON.stringify({ type: 'email.delivered', pad: 'x'.repeat(MAX_EVENT_BYTES) })
    expect(await status(post(big))).toBe(413)
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(big))
        controller.close()
      },
    })
    const undeclared = new Request('http://localhost/mail/events', {
      method: 'POST',
      body: stream,
      duplex: 'half',
    } as RequestInit)
    expect(await status(undeclared)).toBe(413)
  })

  it('answers 400 for a correctly signed body that isn’t JSON', async () => {
    expect(await status(post('{"type": "email.bounced",'))).toBe(400)
  })

  it('answers 500 when the database fails, so Resend tries again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await raw`alter table email_tokens rename to email_tokens_away`
    try {
      expect(await status(post(to('email.bounced', 'ann@example.com')))).toBe(500)
    } finally {
      await raw`alter table email_tokens_away rename to email_tokens`
    }
  })
})

describe('marking an address', () => {
  it('marks every account with a permanently bounced address, in any case, and its pending links', async () => {
    const ann = await withAddress('ann', 'Ann@Example.com')
    const twin = await withAddress('twin', 'ann@example.com')
    const other = await withAddress('other', 'other@example.com')
    const pending = await withAddress('pending', null)
    await createToken(getDb(), {
      userId: pending.id,
      purpose: 'verify',
      email: 'ANN@example.com',
      limit: EMAIL_VERIFY_LIMIT,
    })

    expect(await status(post(to('email.bounced', 'ann@EXAMPLE.com')))).toBe(200)
    expect((await findUserById(getDb(), ann.id))?.emailBouncedAt).toBeInstanceOf(Date)
    expect((await findUserById(getDb(), twin.id))?.emailBouncedAt).toBeInstanceOf(Date)
    expect((await findUserById(getDb(), other.id))?.emailBouncedAt).toBeNull()
    expect((await pendingAddress(getDb(), pending.id))?.bounced).toBe(true)
    expect(await bouncedEvents()).toEqual([
      [ann.id, { kind: 'bounce' }],
      [twin.id, { kind: 'bounce' }],
      [pending.id, { kind: 'bounce' }],
    ])

    const [before] = await raw<{ at: Date }[]>`select email_bounced_at as at from users where id = ${ann.id}`
    expect(await status(post(to('email.bounced', 'ann@example.com')))).toBe(200)
    const [after] = await raw<{ at: Date }[]>`select email_bounced_at as at from users where id = ${ann.id}`
    expect(after?.at).toEqual(before?.at)
    expect(await bouncedEvents()).toHaveLength(3)
  })

  it('marks complaints and suppressed sends, and every address in one event', async () => {
    const ann = await withAddress('ann', 'ann@example.com')
    const bob = await withAddress('bob', 'bob@example.org')
    const cy = await withAddress('cyd', 'cy@example.net')
    expect(await status(post(to('email.complained', 'ann@example.com', 'bob@example.org')))).toBe(200)
    expect(await status(post(to('email.suppressed', 'cy@example.net')))).toBe(200)
    expect(await bouncedEvents()).toEqual([
      [ann.id, { kind: 'complaint' }],
      [bob.id, { kind: 'complaint' }],
      [cy.id, { kind: 'suppressed' }],
    ])
  })

  it('ignores a temporary bounce, other events and unknown addresses with 200', async () => {
    const ann = await withAddress('ann', 'ann@example.com')
    const event = fixture('email.bounced')
    const temporary = JSON.stringify({
      ...event,
      data: { ...event.data, to: ['ann@example.com'], bounce: { type: 'Temporary' } },
    })
    expect(await status(post(temporary))).toBe(200)
    expect(await status(post(JSON.stringify({ type: 'email.delivered', data: { to: ['ann@example.com'] } })))).toBe(200)
    expect(await status(post(to('email.bounced', 'nobody@example.com')))).toBe(200)
    expect((await findUserById(getDb(), ann.id))?.emailBouncedAt).toBeNull()
    expect(await bouncedEvents()).toEqual([])
  })
})

describe('sendMail', () => {
  const notice: OutgoingMail = {
    to: 'ann@example.com',
    kind: 'address-changed',
    subject: 'Your Folio email address was changed',
    text: 'Hello',
  }
  const files = () => readdirSync(dir)

  it('writes a captured message as JSON', async () => {
    expect(mailAvailable()).toBe(true)
    expect(await sendMail(getDb(), notice)).toBe('sent')
    const [name] = files()
    expect(name).toMatch(/^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d\.\d{3}Z-[0-9a-f]{8}\.json$/)
    expect(JSON.parse(readFileSync(join(dir, name ?? ''), 'utf8'))).toMatchObject({
      to: 'ann@example.com',
      from: 'Folio <no-reply@folio.test>',
      kind: 'address-changed',
      subject: 'Your Folio email address was changed',
      text: 'Hello',
    })
  })

  it('creates the capture folder when it is missing', async () => {
    config.mail = { transport: 'capture', from: 'Folio <no-reply@folio.test>', dir: join(dir, 'nested', 'mail') }
    expect(await sendMail(getDb(), notice)).toBe('sent')
    expect(readdirSync(join(dir, 'nested', 'mail'))).toHaveLength(1)
  })

  it('sends nothing to a marked address but a confirmation link', async () => {
    await withAddress('ann', 'ann@example.com')
    expect(await status(post(to('email.bounced', 'ann@example.com')))).toBe(200)
    expect(await isMarkedBounced(getDb(), 'ANN@example.com')).toBe(true)
    expect(await sendMail(getDb(), notice)).toBe('skipped')
    expect(await sendMail(getDb(), { ...notice, kind: 'reset' })).toBe('skipped')
    expect(files()).toEqual([])
    expect(await sendMail(getDb(), { ...notice, kind: 'confirm' })).toBe('sent')
    expect(files()).toHaveLength(1)
  })

  it('is off without mail, and unavailable when the capture folder can’t be written', async () => {
    config.mail = null
    expect(mailAvailable()).toBe(false)
    expect(await sendMail(getDb(), notice)).toBe('off')
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const blocked = join(dir, 'a-file')
    writeFileSync(blocked, 'not a folder')
    config.mail = { transport: 'capture', from: 'Folio <no-reply@folio.test>', dir: blocked }
    expect(await sendMail(getDb(), notice)).toBe('unavailable')
    expect(log.mock.calls.flat().join('\n')).not.toContain('ann@example.com')
  })

  it('goes through Resend when configured', async () => {
    config.mail = {
      transport: 'resend',
      from: 'Folio <no-reply@folio.test>',
      apiKey: 're_x',
      apiBase: 'https://r.test',
    }
    const fetch = vi.fn(async () => Response.json({ id: 'e-1' }))
    expect(await sendMail(getDb(), notice, { fetch })).toBe('sent')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
