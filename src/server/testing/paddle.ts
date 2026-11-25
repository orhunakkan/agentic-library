import type { BillingConfig } from '../config.ts'

export const TEST_PRICES = {
  monthly: 'pri_01testmonthly',
  yearly: 'pri_01testyearly',
  founding: 'pri_01testfounding',
} as const

export const TEST_BILLING: BillingConfig = {
  env: 'sandbox',
  apiBase: 'http://paddle.test',
  apiKey: 'pdl_sdbx_apikey_01testtesttesttesttest',
  webhookSecret: 'pdl_ntfset_01testsecrettestsecret',
  clientToken: 'test_0123456789abcdef',
  prices: { ...TEST_PRICES },
}

export interface SubscriptionFixture {
  id?: string
  status?: string
  priceId?: string
  userId?: number | string | null
  customerId?: string
  periodEndsAt?: string | null
  cancelAt?: string | null
  canceledAt?: string | null
  createdAt?: string
  updatedAt?: string
}

export function paddleSubscription(fixture: SubscriptionFixture = {}): Record<string, unknown> {
  const priceId = fixture.priceId ?? TEST_PRICES.monthly
  const interval = priceId === TEST_PRICES.monthly ? 'month' : 'year'
  const periodEndsAt = fixture.periodEndsAt === undefined ? '2026-12-10T09:00:00.000Z' : fixture.periodEndsAt
  return {
    id: fixture.id ?? 'sub_01testsubscription',
    status: fixture.status ?? 'active',
    customer_id: fixture.customerId ?? 'ctm_01testcustomer',
    address_id: 'add_01testaddress',
    currency_code: 'USD',
    created_at: fixture.createdAt ?? '2026-11-10T09:00:00.000Z',
    updated_at: fixture.updatedAt ?? '2026-11-10T09:00:00.000Z',
    started_at: '2026-11-10T09:00:00.000Z',
    first_billed_at: '2026-11-10T09:00:00.000Z',
    next_billed_at: periodEndsAt,
    paused_at: null,
    canceled_at: fixture.canceledAt ?? null,
    collection_mode: 'automatic',
    billing_cycle: { interval, frequency: 1 },
    current_billing_period: periodEndsAt ? { starts_at: '2026-11-10T09:00:00.000Z', ends_at: periodEndsAt } : null,
    scheduled_change: fixture.cancelAt ? { action: 'cancel', effective_at: fixture.cancelAt, resume_at: null } : null,
    items: [
      {
        status: 'active',
        quantity: 1,
        recurring: true,
        price: {
          id: priceId,
          product_id: 'pro_01testproduct',
          billing_cycle: { interval, frequency: 1 },
          tax_mode: 'internal',
        },
      },
    ],
    custom_data: fixture.userId === null ? null : { folio_user: String(fixture.userId ?? 1) },
  }
}

let events = 0

export function paddleEvent(
  eventType: string,
  data: unknown,
  { eventId, occurredAt = new Date().toISOString() }: { eventId?: string; occurredAt?: string } = {},
): Record<string, unknown> {
  return {
    event_id: eventId ?? `evt_01test${String(++events).padStart(6, '0')}${Date.now()}`,
    event_type: eventType,
    occurred_at: occurredAt,
    notification_id: `ntf_01test${events}`,
    data,
  }
}
