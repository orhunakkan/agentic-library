import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { handlePaddleEvent, MAX_WEBHOOK_BYTES } from '~/server/billing/webhook'
import { type Config, getConfig } from '~/server/config'
import { closeDb, getDb } from '~/server/db'
import { hashToken, newSessionToken } from '~/server/security'
import { createSession, findSession } from '~/server/sessions'
import { databaseUrl, freshDatabase } from '../testing/db'
import { paddleEvent, paddleSubscription, type SubscriptionFixture, TEST_BILLING, TEST_PRICES } from '../testing/paddle'
import { testUser } from '../testing/users'
import { paddleSignature } from './signature'
import { sweepPaddleEvents } from './store'

const raw = postgres(databaseUrl, { max: 1, onnotice: () => {} })
const config = getConfig() as { -readonly [K in keyof Config]: Config[K] }
const HASH = '$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA'
const NOW = new Date('2026-11-10T12:00:00Z')
const TS = String(NOW.getTime() / 1000)

beforeAll(freshDatabase)
afterAll(async () => {
  config.billing = null
  await raw.end()
  await closeDb()
})
beforeEach(async () => {
  config.billing = TEST_BILLING
  await raw`truncate users, sessions, audit_events, subscriptions, paddle_events restart identity cascade`
})
afterEach(() => vi.restoreAllMocks())

function post(body: string, { secret = TEST_BILLING.webhookSecret, ts = TS, signature = '' } = {}) {
  return new Request('http://localhost/billing/paddle', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'paddle-signature': signature || `ts=${ts};h1=${paddleSignature(secret, ts, body)}`,
    },
    body,
  })
}

const send = (body: string, options?: Parameters<typeof post>[1]) => handlePaddleEvent(post(body, options), NOW)

const event = (type: string, f: SubscriptionFixture, at = '2026-11-10T11:59:00.000Z', eventId?: string) =>
  JSON.stringify(paddleEvent(type, paddleSubscription(f), { occurredAt: at, eventId }))

async function member() {
  const user = await testUser(getDb(), `reader-${Math.random().toString(36).slice(2, 8)}`, HASH, 'member', {
    plan: 'free',
  })
  const token = newSessionToken()
  await createSession(getDb(), { tokenHash: hashToken(token), userId: user.id, ip: null, userAgent: 'test' })
  return { id: user.id, plan: async () => (await findSession(getDb(), hashToken(token)))?.plan }
}

const rows = () =>
  raw<{ id: string; user_id: string | null; customer_id: string | null; status: string; founding: boolean }[]>`
    select id, user_id, customer_id, status, founding from subscriptions order by id`

const audits = () =>
  raw<{ user_id: string | null; detail: object }[]>`
    select user_id, detail from audit_events where event = 'billing.subscription' order by id`

describe('a signed subscription event', () => {
  it('makes a row, and the account Pro from its next request', async () => {
    const reader = await member()
    expect(await reader.plan()).toBe('free')
    const response = await send(event('subscription.created', { userId: reader.id }))
    expect([response.status, await response.text()]).toEqual([200, 'Recorded'])
    expect(await rows()).toEqual([
      {
        id: 'sub_01testsubscription',
        user_id: String(reader.id),
        customer_id: 'ctm_01testcustomer',
        status: 'active',
        founding: false,
      },
    ])
    expect(await reader.plan()).toBe('pro')
    expect(await audits()).toEqual([
      {
        user_id: String(reader.id),
        detail: { subscription: 'sub_01testsubscription', status: 'active', by: 'paddle' },
      },
    ])
  })

  it('changes nothing when the same event_id comes again', async () => {
    const reader = await member()
    const body = event('subscription.created', { userId: reader.id }, undefined, 'evt_01same')
    expect((await send(body)).status).toBe(200)
    const again = await send(
      event('subscription.canceled', { userId: reader.id, status: 'canceled' }, '2026-11-10T11:59:30Z', 'evt_01same'),
    )
    expect([again.status, await again.text()]).toEqual([200, 'Already recorded'])
    expect((await rows())[0]?.status).toBe('active')
    expect(await raw`select 1 from paddle_events`).toHaveLength(1)
  })

  it('ignores an older event that arrives after a newer one', async () => {
    const reader = await member()
    await send(event('subscription.canceled', { userId: reader.id, status: 'canceled' }, '2026-11-10T11:59:30Z'))
    const late = await send(event('subscription.activated', { userId: reader.id }, '2026-11-10T11:58:00Z'))
    expect(late.status).toBe(200)
    expect((await rows())[0]?.status).toBe('canceled')
    expect(await reader.plan()).toBe('free')
    expect((await audits()).map((a) => (a.detail as { status: string }).status)).toEqual(['canceled'])
    expect(await raw`select 1 from paddle_events`).toHaveLength(2)
  })

  it('keeps Pro while past due, and not while paused or canceled', async () => {
    const reader = await member()
    const at = (s: number) => `2026-11-10T11:5${s}:00.000Z`
    await send(event('subscription.created', { userId: reader.id }, at(0)))
    await send(event('subscription.past_due', { userId: reader.id, status: 'past_due' }, at(1)))
    expect(await reader.plan()).toBe('pro')
    await send(event('subscription.paused', { userId: reader.id, status: 'paused' }, at(2)))
    expect(await reader.plan()).toBe('free')
    await send(event('subscription.resumed', { userId: reader.id }, at(3)))
    expect(await reader.plan()).toBe('pro')
    await send(event('subscription.canceled', { userId: reader.id, status: 'canceled' }, at(4)))
    expect(await reader.plan()).toBe('free')
    expect((await audits()).map((a) => (a.detail as { status: string }).status)).toEqual([
      'active',
      'past_due',
      'paused',
      'active',
      'canceled',
    ])
  })

  it('keeps Pro with a scheduled cancel, and stores when it ends', async () => {
    const reader = await member()
    await send(event('subscription.created', { userId: reader.id }, '2026-11-10T11:58:00Z'))
    await send(event('subscription.updated', { userId: reader.id, cancelAt: '2026-12-10T09:00:00.000Z' }))
    expect(await reader.plan()).toBe('pro')
    const [row] = await raw<{ cancel_at: Date | null }[]>`select cancel_at from subscriptions`
    expect(row?.cancel_at).toEqual(new Date('2026-12-10T09:00:00.000Z'))
    expect(await audits()).toHaveLength(1)
  })

  it('marks the founding price', async () => {
    const reader = await member()
    await send(event('subscription.created', { userId: reader.id, priceId: TEST_PRICES.founding }))
    expect((await rows())[0]?.founding).toBe(true)
  })

  it('stores the row without an account when folio_user is unknown', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const response = await send(event('subscription.created', { userId: 9999 }))
    expect(response.status).toBe(200)
    expect(await rows()).toEqual([
      { id: 'sub_01testsubscription', user_id: null, customer_id: null, status: 'active', founding: false },
    ])
    expect(String(warn.mock.calls[0]?.[0])).toContain("doesn't exist")
    expect((await audits())[0]?.user_id).toBeNull()
  })

  it('keeps the account the row has when a later event names none', async () => {
    const reader = await member()
    await send(event('subscription.created', { userId: reader.id }, '2026-11-10T11:58:00Z'))
    await send(event('subscription.updated', { userId: null, status: 'past_due' }))
    expect(await rows()).toEqual([
      expect.objectContaining({ user_id: String(reader.id), customer_id: 'ctm_01testcustomer', status: 'past_due' }),
    ])
  })
})

describe('what isn’t a subscription change', () => {
  it('records transaction.completed and changes nothing', async () => {
    const body = JSON.stringify(paddleEvent('transaction.completed', { id: 'txn_01abc', status: 'completed' }))
    expect((await send(body)).status).toBe(200)
    expect(await rows()).toEqual([])
    expect(await raw`select event_type from paddle_events`).toEqual([{ event_type: 'transaction.completed' }])
  })

  it('answers 200 to an event type outside the list, and writes nothing', async () => {
    const body = JSON.stringify(paddleEvent('customer.updated', { id: 'ctm_01abc' }))
    const response = await send(body)
    expect([response.status, await response.text()]).toEqual([200, 'Ignored'])
    expect(await raw`select 1 from paddle_events`).toEqual([])
  })
})

describe('refusals', () => {
  it('is 401 for an unsigned or wrongly signed request, logged without the body, and stores nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const reader = await member()
    const body = event('subscription.created', { userId: reader.id })
    const unsigned = new Request('http://localhost/billing/paddle', { method: 'POST', body })
    expect((await handlePaddleEvent(unsigned, NOW)).status).toBe(401)
    expect((await send(body, { secret: 'pdl_ntfset_someoneelse' })).status).toBe(401)
    expect((await send(body, { ts: String(Number(TS) - 30) })).status).toBe(401)
    expect(await rows()).toEqual([])
    expect(await raw`select 1 from paddle_events`).toEqual([])
    const logged = warn.mock.calls.map((c) => String(c[0]))
    expect(logged).toEqual([
      '[paddle webhook] refused: malformed',
      '[paddle webhook] refused: bad-signature',
      "[paddle webhook] refused: the signature is 30 s off the server's clock",
    ])
    expect(logged.join('\n')).not.toContain('ctm_01')
  })

  it('is 404 when billing is off', async () => {
    config.billing = null
    expect((await send(event('subscription.created', {}))).status).toBe(404)
  })

  it('is 413 over 64 KB', async () => {
    const big = JSON.stringify({ pad: 'x'.repeat(MAX_WEBHOOK_BYTES) })
    expect((await send(big)).status).toBe(413)
  })

  it('is 400 for a signed body that isn’t JSON, an event or a subscription', async () => {
    expect((await send('{nope')).status).toBe(400)
    expect((await send(JSON.stringify({ hello: 'paddle' }))).status).toBe(400)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await send(JSON.stringify(paddleEvent('subscription.created', { id: 'nope' })))).status).toBe(400)
    expect(warn).toHaveBeenCalledOnce()
    expect(await raw`select 1 from paddle_events`).toEqual([])
  })

  it('is 500 for a status the table doesn’t take yet, so Paddle retries', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await send(event('subscription.updated', { status: 'frozen' }))).status).toBe(500)
    expect(String(error.mock.calls[0]?.[0])).toContain('"frozen"')
    expect(await raw`select 1 from paddle_events`).toEqual([])
  })

  it('is 500 when the database fails, and the event isn’t recorded, so the retry applies it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const reader = await member()
    await raw`alter table subscriptions add constraint test_refuse check (status <> 'trialing')`
    try {
      const body = event('subscription.trialing', { userId: reader.id, status: 'trialing' }, undefined, 'evt_01retry')
      expect((await send(body)).status).toBe(500)
      expect(error).toHaveBeenCalledOnce()
      expect(await raw`select 1 from paddle_events`).toEqual([])
    } finally {
      await raw`alter table subscriptions drop constraint test_refuse`
    }
    const retry = event('subscription.trialing', { userId: reader.id, status: 'trialing' }, undefined, 'evt_01retry')
    expect((await send(retry)).status).toBe(200)
    expect(await reader.plan()).toBe('pro')
  })
})

describe('sweepPaddleEvents', () => {
  it('deletes events received more than 90 days ago', async () => {
    await raw`
      insert into paddle_events (event_id, event_type, occurred_at, received_at)
      values ('evt_old', 'subscription.created', now(), now() - interval '91 days'),
        ('evt_new', 'subscription.created', now(), now() - interval '89 days')`
    expect(await sweepPaddleEvents(getDb())).toBe(1)
    expect(await raw`select event_id from paddle_events`).toEqual([{ event_id: 'evt_new' }])
  })
})
