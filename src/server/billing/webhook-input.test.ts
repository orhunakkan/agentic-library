import { describe, expect, it } from 'vitest'
import { BILLING_STATUSES } from '../../shared/billing/billing'
import { paddleEvent, paddleSubscription, TEST_PRICES } from '../testing/paddle'
import { isWebhookEvent, parsePaddleEvent, subscriptionRow } from './webhook-input'

const AT = new Date('2026-11-10T10:00:00.000Z')
const map = (entity: unknown) => subscriptionRow(entity, TEST_PRICES, AT)

describe('parsePaddleEvent', () => {
  it('reads the envelope', () => {
    const event = paddleEvent(
      'subscription.created',
      { id: 'sub_x' },
      { eventId: 'evt_01a', occurredAt: AT.toISOString() },
    )
    expect(parsePaddleEvent(event)).toEqual({
      eventId: 'evt_01a',
      eventType: 'subscription.created',
      occurredAt: AT,
      data: { id: 'sub_x' },
    })
  })

  it('refuses anything else', () => {
    const good = paddleEvent('subscription.created', {}, { eventId: 'evt_01a' })
    for (const bad of [
      null,
      [],
      'evt',
      { ...good, event_id: '' },
      { ...good, event_id: 'e'.repeat(101) },
      { ...good, event_type: 7 },
      { ...good, occurred_at: 'yesterday' },
      { ...good, occurred_at: undefined },
    ])
      expect(parsePaddleEvent(bad), JSON.stringify(bad)).toBeNull()
  })

  it('knows the events the destination sends', () => {
    expect(isWebhookEvent('subscription.past_due')).toBe(true)
    expect(isWebhookEvent('transaction.completed')).toBe(true)
    expect(isWebhookEvent('customer.updated')).toBe(false)
  })
})

describe('subscriptionRow', () => {
  it('maps a monthly subscription', () => {
    expect(map(paddleSubscription({ id: 'sub_01monthly', userId: 42 }))).toEqual({
      ok: true,
      row: {
        id: 'sub_01monthly',
        userId: 42,
        customerId: 'ctm_01testcustomer',
        priceId: TEST_PRICES.monthly,
        cadence: 'month',
        founding: false,
        status: 'active',
        periodEndsAt: new Date('2026-12-10T09:00:00.000Z'),
        cancelAt: null,
        canceledAt: null,
        createdAt: new Date('2026-11-10T09:00:00.000Z'),
        eventAt: AT,
      },
    })
  })

  it('marks the founding price, and reads the yearly cycle', () => {
    const founding = map(paddleSubscription({ priceId: TEST_PRICES.founding }))
    const yearly = map(paddleSubscription({ priceId: TEST_PRICES.yearly }))
    expect(founding.ok && [founding.row.cadence, founding.row.founding]).toEqual(['year', true])
    expect(yearly.ok && [yearly.row.cadence, yearly.row.founding]).toEqual(['year', false])
  })

  it('takes every status Paddle has today', () => {
    for (const status of BILLING_STATUSES) {
      const mapped = map(paddleSubscription({ status }))
      expect(mapped.ok && mapped.row.status).toBe(status)
    }
  })

  it('names a status Paddle adds later', () => {
    expect(map(paddleSubscription({ status: 'frozen' }))).toEqual({
      ok: false,
      reason: 'unknown_status',
      status: 'frozen',
    })
  })

  it('reads a scheduled cancel, and only a cancel', () => {
    const scheduled = map(paddleSubscription({ cancelAt: '2026-12-10T09:00:00.000Z' }))
    expect(scheduled.ok && scheduled.row.cancelAt).toEqual(new Date('2026-12-10T09:00:00.000Z'))
    const pause = paddleSubscription()
    pause.scheduled_change = { action: 'pause', effective_at: '2026-12-10T09:00:00.000Z', resume_at: null }
    const paused = map(pause)
    expect(paused.ok && paused.row.cancelAt).toBeNull()
    const canceled = map(
      paddleSubscription({ status: 'canceled', canceledAt: '2026-11-11T00:00:00Z', periodEndsAt: null }),
    )
    expect(canceled.ok && [canceled.row.canceledAt, canceled.row.periodEndsAt]).toEqual([
      new Date('2026-11-11T00:00:00Z'),
      null,
    ])
  })

  it('stores the row without an account when folio_user is missing or malformed', () => {
    for (const userId of [null, 'abc', '0', '1.5', '-3', '99999999999999999'] as const) {
      const mapped = map(paddleSubscription({ userId }))
      expect(mapped.ok && mapped.row.userId, String(userId)).toBeNull()
    }
  })

  it('takes the subscription’s cycle when the price has none', () => {
    const entity = paddleSubscription({ priceId: TEST_PRICES.yearly })
    const [item] = entity.items as { price: Record<string, unknown> }[]
    if (item) delete item.price.billing_cycle
    const mapped = map(entity)
    expect(mapped.ok && mapped.row.cadence).toBe('year')
  })

  it('refuses an entity without an id, a price, a month or year cycle or a status', () => {
    const broken = (change: (e: Record<string, unknown>) => void) => {
      const entity = paddleSubscription()
      change(entity)
      return map(entity)
    }
    for (const result of [
      map(null),
      map('sub_01'),
      broken((e) => {
        e.id = 'abc'
      }),
      broken((e) => {
        e.items = []
      }),
      broken((e) => {
        e.status = 3
      }),
      broken((e) => {
        e.billing_cycle = { interval: 'week', frequency: 1 }
        for (const item of e.items as { price: Record<string, unknown> }[]) delete item.price.billing_cycle
      }),
    ])
      expect(result).toEqual({ ok: false, reason: 'invalid' })
  })

  it('leaves out ids and dates that aren’t Paddle’s', () => {
    const entity = paddleSubscription({ customerId: 'cus_123', createdAt: 'not a date' })
    const mapped = map(entity)
    expect(mapped.ok && [mapped.row.customerId, mapped.row.createdAt]).toEqual([null, null])
  })
})
