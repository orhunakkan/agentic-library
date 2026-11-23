import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/server/db')>()
  return { ...actual, getDb: vi.fn(actual.getDb) }
})

import {
  billingOffer,
  forgetBillingOffer,
  handleCheckout,
  handlePlanState,
  handlePortal,
  parseCheckout,
  planStateFor,
} from '~/server/billing/actions'
import { type Config, getConfig } from '~/server/config'
import { closeDb, getDb, type Pool } from '~/server/db'
import { hashToken, newSessionToken } from '~/server/security'
import { createSession, findSession } from '~/server/sessions'
import { databaseUrl, freshDatabase } from '../testing/db'
import { TEST_BILLING, TEST_PRICES } from '../testing/paddle'
import { testUser } from '../testing/users'

const raw = postgres(databaseUrl, { max: 1, onnotice: () => {} })
const config = getConfig() as { -readonly [K in keyof Config]: Config[K] }
const origin = config.appOrigin
const cookieName = config.cookieSecure ? '__Host-session' : 'session'
const HASH = '$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA'

beforeAll(freshDatabase)
afterAll(async () => {
  config.billing = null
  await raw.end()
  await closeDb()
})
beforeEach(async () => {
  config.billing = TEST_BILLING
  forgetBillingOffer()
  await raw`truncate users, sessions, audit_events, subscriptions restart identity cascade`
})
afterEach(() => vi.restoreAllMocks())

let users = 0
async function signedIn(role: 'admin' | 'member' = 'member', plan: 'free' | 'pro' = 'free') {
  const user = await testUser(getDb(), `reader-${++users}`, HASH, role, { plan })
  const token = newSessionToken()
  await createSession(getDb(), { tokenHash: hashToken(token), userId: user.id, ip: null, userAgent: 'test' })
  return { user, cookie: `${cookieName}=${token}`, hash: hashToken(token) }
}

const post = (path: string, cookie: string, body: unknown = {}, headers: Record<string, string> = {}) =>
  new Request(`${origin}${path}`, {
    method: 'POST',
    headers: { origin, cookie, 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

function paddle(answer: (url: string, body: unknown) => Response) {
  const calls: { url: string; body: unknown }[] = []
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null
    calls.push({ url: String(input), body })
    return answer(String(input), body)
  }) as typeof globalThis.fetch
  return { calls, fetch }
}
const transaction = () => paddle(() => Response.json({ data: { id: 'txn_01checkout', status: 'ready' } }))

const broken = (() => {
  throw new Error('the database went away')
}) as unknown as Pool

const answer = async (response: Response) => [response.status, await response.json().catch(() => null)]

async function subscribe(userId: number | null, id: string, f: { status?: string; founding?: boolean } = {}) {
  await raw`
    insert into subscriptions (id, user_id, customer_id, price_id, cadence, founding, status, period_ends_at, event_at)
    values (${id}, ${userId}, ${userId ? 'ctm_01customer' : null}, ${f.founding ? TEST_PRICES.founding : TEST_PRICES.monthly},
      ${f.founding ? 'year' : 'month'}, ${f.founding ?? false}, ${f.status ?? 'active'}, '2026-12-10T09:00:00Z', now())`
}

const founders = (n: number) => raw`
  insert into subscriptions (id, price_id, cadence, founding, status, event_at)
  select 'sub_01founder' || g, ${TEST_PRICES.founding}, 'year', true, 'canceled', now() from generate_series(1, ${n}) g`

describe('parseCheckout', () => {
  it('takes exactly a cadence', () => {
    expect(parseCheckout({ cadence: 'month' })).toEqual({ cadence: 'month' })
    expect(parseCheckout({ cadence: 'year' })).toEqual({ cadence: 'year' })
    for (const bad of [null, [], {}, { cadence: 'week' }, { cadence: 'year', price: TEST_PRICES.founding }])
      expect(parseCheckout(bad)).toBeNull()
  })
})

describe('POST /account/plan/checkout', () => {
  it('gives a Free member a monthly transaction for their own account, audited', async () => {
    const { user, cookie } = await signedIn()
    await raw`update users set email = 'ada@example.com', email_verified_at = now() where id = ${user.id}`
    const stub = transaction()
    expect(
      await answer(await handleCheckout(post('/account/plan/checkout', cookie, { cadence: 'month' }), stub)),
    ).toEqual([
      200,
      {
        transactionId: 'txn_01checkout',
        clientToken: TEST_BILLING.clientToken,
        env: 'sandbox',
        email: 'ada@example.com',
      },
    ])
    expect(stub.calls).toEqual([
      {
        url: 'http://paddle.test/transactions',
        body: { items: [{ price_id: TEST_PRICES.monthly, quantity: 1 }], custom_data: { folio_user: String(user.id) } },
      },
    ])
    expect(await raw`select user_id, detail from audit_events where event = 'billing.checkout'`).toEqual([
      { user_id: String(user.id), detail: { cadence: 'month', founding: false } },
    ])
    expect(await raw`select 1 from subscriptions`).toEqual([])
  })

  it('leaves the address out when it isn’t confirmed or has bounced', async () => {
    const { user, cookie } = await signedIn()
    await raw`update users set email = 'ada@example.com', email_verified_at = now(), email_bounced_at = now()
      where id = ${user.id}`
    const response = await handleCheckout(post('/account/plan/checkout', cookie, { cadence: 'month' }), transaction())
    expect((await response.json()).email).toBeNull()
  })

  it('uses the founding price on yearly with 99 founders, and the regular one with 100', async () => {
    const { cookie } = await signedIn()
    await founders(99)
    const first = transaction()
    expect((await handleCheckout(post('/account/plan/checkout', cookie, { cadence: 'year' }), first)).status).toBe(200)
    expect(first.calls[0]?.body).toMatchObject({ items: [{ price_id: TEST_PRICES.founding }] })
    await raw`
      insert into subscriptions (id, price_id, cadence, founding, status, event_at)
      values ('sub_01founder100', ${TEST_PRICES.founding}, 'year', true, 'active', now())`
    const second = transaction()
    expect((await handleCheckout(post('/account/plan/checkout', cookie, { cadence: 'year' }), second)).status).toBe(200)
    expect(second.calls[0]?.body).toMatchObject({ items: [{ price_id: TEST_PRICES.yearly }] })
    expect((await raw`select detail from audit_events order by id`).map((r) => r.detail)).toEqual([
      { cadence: 'year', founding: true },
      { cadence: 'year', founding: false },
    ])
  })

  it('refuses a member whose subscription makes them Pro, but not one whose subscription ended', async () => {
    const { user, cookie } = await signedIn()
    await subscribe(user.id, 'sub_01ended', { status: 'canceled' })
    expect(
      (await handleCheckout(post('/account/plan/checkout', cookie, { cadence: 'month' }), transaction())).status,
    ).toBe(200)
    await subscribe(user.id, 'sub_01pastdue', { status: 'past_due' })
    const stub = transaction()
    expect(
      await answer(await handleCheckout(post('/account/plan/checkout', cookie, { cadence: 'month' }), stub)),
    ).toEqual([409, { error: 'subscribed' }])
    expect(stub.calls).toEqual([])
  })

  it('refuses an admin and a member given Pro', async () => {
    for (const [role, plan] of [
      ['admin', 'free'],
      ['member', 'pro'],
    ] as const) {
      const { cookie } = await signedIn(role, plan)
      const stub = transaction()
      expect(
        await answer(await handleCheckout(post('/account/plan/checkout', cookie, { cadence: 'year' }), stub)),
      ).toEqual([409, { error: 'pro' }])
      expect(stub.calls).toEqual([])
    }
  })

  it('refuses the signed out and a bad body', async () => {
    const { cookie } = await signedIn()
    const stub = transaction()
    expect(await answer(await handleCheckout(post('/account/plan/checkout', '', { cadence: 'month' }), stub))).toEqual([
      401,
      { error: 'signed_out' },
    ])
    expect((await handleCheckout(post('/account/plan/checkout', cookie, '{nope'), stub)).status).toBe(400)
    expect((await handleCheckout(post('/account/plan/checkout', cookie, { cadence: 'week' }), stub)).status).toBe(400)
    expect(stub.calls).toEqual([])
  })

  it('is 404 when billing is off', async () => {
    const { cookie } = await signedIn()
    config.billing = null
    expect(await answer(await handleCheckout(post('/account/plan/checkout', cookie, { cadence: 'month' })))).toEqual([
      404,
      { error: 'not_found' },
    ])
  })

  it('is 502 when Paddle fails, and 500 when the database does, with nothing audited', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { cookie } = await signedIn()
    const down = paddle(() => new Response('{}', { status: 503 }))
    expect(
      await answer(await handleCheckout(post('/account/plan/checkout', cookie, { cadence: 'month' }), down)),
    ).toEqual([502, { error: 'failed' }])
    vi.mocked(getDb).mockReturnValueOnce(getDb()).mockReturnValueOnce(broken)
    const failed = await handleCheckout(post('/account/plan/checkout', cookie, { cadence: 'month' }), transaction())
    expect(failed.status).toBe(500)
    expect(await raw`select 1 from audit_events`).toEqual([])
    expect(error).toHaveBeenCalledTimes(2)
  })
})

describe('POST /account/plan/portal', () => {
  const portal = () =>
    paddle(() =>
      Response.json({ data: { urls: { general: { overview: 'https://customer-portal.paddle.com/cpl_01abc' } } } }),
    )

  it('answers the portal’s address for the account’s subscription', async () => {
    const { user, cookie } = await signedIn()
    await subscribe(user.id, 'sub_01mine')
    const stub = portal()
    expect(await answer(await handlePortal(post('/account/plan/portal', cookie), stub))).toEqual([
      200,
      { url: 'https://customer-portal.paddle.com/cpl_01abc' },
    ])
    expect(stub.calls).toEqual([
      {
        url: 'http://paddle.test/customers/ctm_01customer/portal-sessions',
        body: { subscription_ids: ['sub_01mine'] },
      },
    ])
  })

  it('is 404 without a subscription, or with another account’s only', async () => {
    const { cookie } = await signedIn()
    const other = await signedIn()
    await subscribe(other.user.id, 'sub_01theirs')
    const stub = portal()
    expect(await answer(await handlePortal(post('/account/plan/portal', cookie), stub))).toEqual([
      404,
      { error: 'not_found' },
    ])
    expect(stub.calls).toEqual([])
  })

  it('refuses the signed out, is 404 with billing off and 502 when Paddle fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { user, cookie } = await signedIn()
    await subscribe(user.id, 'sub_01mine')
    expect((await handlePortal(post('/account/plan/portal', ''), portal())).status).toBe(401)
    const down = paddle(() => new Response('{}', { status: 500 }))
    expect((await handlePortal(post('/account/plan/portal', cookie), down)).status).toBe(502)
    expect(error).toHaveBeenCalledOnce()
    config.billing = null
    expect((await handlePortal(post('/account/plan/portal', cookie), portal())).status).toBe(404)
  })
})

describe('the plan’s state', () => {
  it('says Free, with the founding spots left', async () => {
    const { hash } = await signedIn()
    await founders(3)
    const session = await findSession(getDb(), hash)
    if (!session) throw new Error('no session')
    expect(await planStateFor(session)).toEqual({
      billing: true,
      plan: 'free',
      source: 'free',
      subscription: null,
      foundingLeft: 97,
    })
  })

  it('says paid, with the subscription’s dates, and when one ended', async () => {
    const { user, hash, cookie } = await signedIn()
    await subscribe(user.id, 'sub_01paid', { founding: true })
    await raw`update subscriptions set cancel_at = '2026-12-10T09:00:00Z'`
    const response = await handlePlanState(new Request(`${origin}/account/plan/state`, { headers: { cookie } }))
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({
      billing: true,
      plan: 'pro',
      source: 'paid',
      subscription: {
        cadence: 'year',
        founding: true,
        status: 'active',
        periodEndsAt: '2026-12-10T09:00:00.000Z',
        cancelAt: '2026-12-10T09:00:00.000Z',
        endedAt: null,
      },
      foundingLeft: 99,
    })
    await raw`update subscriptions set status = 'canceled', canceled_at = '2026-12-10T09:00:00Z'`
    const session = await findSession(getDb(), hash)
    if (!session) throw new Error('no session')
    expect(await planStateFor(session)).toMatchObject({
      plan: 'free',
      source: 'free',
      subscription: { status: 'canceled', periodEndsAt: null, cancelAt: null, endedAt: '2026-12-10T09:00:00.000Z' },
    })
  })

  it('prefers a live subscription over a newer ended one', async () => {
    const { user, hash } = await signedIn()
    await subscribe(user.id, 'sub_01live')
    await subscribe(user.id, 'sub_01newer', { status: 'canceled' })
    await raw`update subscriptions set created_at = now() + interval '1 day' where id = 'sub_01newer'`
    const session = await findSession(getDb(), hash)
    if (!session) throw new Error('no session')
    expect((await planStateFor(session)).subscription?.status).toBe('active')
  })

  it('says billing is off, given or admin', async () => {
    config.billing = null
    const given = await signedIn('member', 'pro')
    const session = await findSession(getDb(), given.hash)
    if (!session) throw new Error('no session')
    expect(await planStateFor(session)).toMatchObject({ billing: false, plan: 'pro', source: 'given' })
  })

  it('is 401 signed out, and 500 when the database fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await handlePlanState(new Request(`${origin}/account/plan/state`))).status).toBe(401)
    const { cookie } = await signedIn()
    vi.mocked(getDb).mockReturnValueOnce(getDb()).mockReturnValueOnce(broken)
    const request = new Request(`${origin}/account/plan/state`, { headers: { cookie } })
    const response = await handlePlanState(request)
    expect([response.status, error.mock.calls.length > 0]).toEqual([500, true])
  })
})

describe('billingOffer', () => {
  it('counts founders, and keeps the count for a minute', async () => {
    await founders(40)
    expect(await billingOffer(1_000)).toEqual({ on: true, foundingLeft: 60 })
    await raw`
      insert into subscriptions (id, price_id, cadence, founding, status, event_at)
      select 'sub_01more' || g, ${TEST_PRICES.founding}, 'year', true, 'active', now() from generate_series(1, 70) g`
    expect(await billingOffer(50_000)).toEqual({ on: true, foundingLeft: 60 })
    expect(await billingOffer(62_000)).toEqual({ on: true, foundingLeft: 0 })
  })

  it('is off without billing settings', async () => {
    config.billing = null
    expect(await billingOffer()).toEqual({ on: false, foundingLeft: 0 })
  })

  it('shows Pro on sale without founding spots when the count fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(getDb).mockReturnValueOnce(broken)
    expect(await billingOffer()).toEqual({ on: true, foundingLeft: 0 })
    expect(error).toHaveBeenCalledOnce()
  })
})
