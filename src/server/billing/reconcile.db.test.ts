import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { reconcileSubscriptions } from '~/server/billing/reconcile'
import { closeDb, getDb } from '~/server/db'
import { databaseUrl, freshDatabase } from '../testing/db'
import { paddleSubscription, TEST_BILLING, TEST_PRICES } from '../testing/paddle'
import { testUser } from '../testing/users'

const raw = postgres(databaseUrl, { max: 1, onnotice: () => {} })
const HASH = '$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA'

beforeAll(freshDatabase)
afterAll(async () => {
  await raw.end()
  await closeDb()
})
beforeEach(async () => {
  await raw`truncate users, audit_events, subscriptions restart identity cascade`
})

function paddle(entities: unknown[], size = 2) {
  const urls: string[] = []
  const fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    urls.push(`${url.pathname}${url.search}`)
    const after = url.searchParams.get('after')
    const start = after ? entities.findIndex((e) => (e as { id: string }).id === after) + 1 : 0
    const page = entities.slice(start, start + size)
    return Response.json({ data: page, meta: { pagination: { has_more: start + size < entities.length } } })
  }) as typeof globalThis.fetch
  return { urls, fetch }
}

describe('reconcileSubscriptions', () => {
  it('upserts every page of subscriptions, and brings an older local row up to date', async () => {
    const user = await testUser(getDb(), 'payer', HASH, 'member', { plan: 'free' })
    await raw`
      insert into subscriptions (id, user_id, customer_id, price_id, cadence, founding, status, event_at)
      values ('sub_01behind', ${user.id}, 'ctm_01testcustomer', ${TEST_PRICES.monthly}, 'month', false, 'active',
        '2026-11-01T00:00:00Z')`
    const entities = [
      paddleSubscription({
        id: 'sub_01behind',
        userId: user.id,
        status: 'canceled',
        canceledAt: '2026-11-09T00:00:00Z',
        updatedAt: '2026-11-09T00:00:00Z',
      }),
      paddleSubscription({ id: 'sub_01missed', userId: user.id, priceId: TEST_PRICES.founding }),
      paddleSubscription({ id: 'sub_01nobody', userId: 424242, priceId: TEST_PRICES.founding }),
    ]
    const stub = paddle(entities)
    expect(await reconcileSubscriptions(getDb(), TEST_BILLING, stub)).toEqual({
      listed: 3,
      updated: 3,
      unchanged: 0,
      skipped: 0,
    })
    expect(stub.urls).toEqual(['/subscriptions?per_page=200', '/subscriptions?per_page=200&after=sub_01missed'])
    expect(await raw`select id, user_id, status, founding from subscriptions order by id`).toEqual([
      { id: 'sub_01behind', user_id: String(user.id), status: 'canceled', founding: false },
      { id: 'sub_01missed', user_id: String(user.id), status: 'active', founding: true },
      { id: 'sub_01nobody', user_id: null, status: 'active', founding: true },
    ])
    expect((await raw`select detail from audit_events order by id`).map((r) => r.detail)).toEqual([
      { subscription: 'sub_01behind', status: 'canceled', by: 'reconcile' },
      { subscription: 'sub_01missed', status: 'active', by: 'reconcile' },
      { subscription: 'sub_01nobody', status: 'active', by: 'reconcile' },
    ])
  })

  it('leaves a row a newer webhook wrote, and skips what it can’t read', async () => {
    await raw`
      insert into subscriptions (id, price_id, cadence, founding, status, event_at)
      values ('sub_01ahead', ${TEST_PRICES.monthly}, 'month', false, 'past_due', '2026-11-20T00:00:00Z')`
    const entities = [
      paddleSubscription({ id: 'sub_01ahead', updatedAt: '2026-11-10T00:00:00Z' }),
      paddleSubscription({ id: 'sub_01frozen', status: 'frozen' }),
      { ...paddleSubscription({ id: 'sub_01nodate' }), updated_at: 'soon' },
      'not a subscription',
    ]
    expect(await reconcileSubscriptions(getDb(), TEST_BILLING, paddle(entities, 10))).toEqual({
      listed: 4,
      updated: 0,
      unchanged: 1,
      skipped: 3,
    })
    expect(await raw`select id, status from subscriptions`).toEqual([{ id: 'sub_01ahead', status: 'past_due' }])
    expect(await raw`select 1 from audit_events`).toEqual([])
  })
})
