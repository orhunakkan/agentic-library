import { type BillingStatus, type Cadence, isBillingStatus } from '../../shared/billing/billing.ts'
import { isObject } from '../../shared/lib/json-shape.ts'

const WEBHOOK_EVENTS = [
  'subscription.created',
  'subscription.activated',
  'subscription.updated',
  'subscription.canceled',
  'subscription.past_due',
  'subscription.paused',
  'subscription.resumed',
  'subscription.trialing',
  'transaction.completed',
] as const
export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number]

export interface PaddleEvent {
  eventId: string
  eventType: string
  occurredAt: Date
  data: unknown
}

export interface SubscriptionRow {
  id: string
  userId: number | null
  customerId: string | null
  priceId: string
  cadence: Cadence
  founding: boolean
  status: BillingStatus
  periodEndsAt: Date | null
  cancelAt: Date | null
  canceledAt: Date | null
  createdAt: Date | null
  eventAt: Date
}

export type MappedSubscription =
  | { ok: true; row: SubscriptionRow }
  | { ok: false; reason: 'invalid' }
  | { ok: false; reason: 'unknown_status'; status: string }

function dateOf(value: unknown): Date | null {
  if (typeof value !== 'string' || value.length > 40) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

const idOf = (value: unknown, prefix: string): string | null =>
  typeof value === 'string' && new RegExp(`^${prefix}_[a-z0-9]{4,60}$`).test(value) ? value : null

export function isWebhookEvent(type: string): type is WebhookEventType {
  return (WEBHOOK_EVENTS as readonly string[]).includes(type)
}

export function parsePaddleEvent(value: unknown): PaddleEvent | null {
  if (!isObject(value)) return null
  const { event_id, event_type, occurred_at, data } = value
  const occurredAt = dateOf(occurred_at)
  if (typeof event_id !== 'string' || event_id.length === 0 || event_id.length > 100) return null
  if (typeof event_type !== 'string' || event_type.length === 0 || event_type.length > 100 || !occurredAt) return null
  return { eventId: event_id, eventType: event_type, occurredAt, data }
}

function folioUser(customData: unknown): number | null {
  const user = isObject(customData) ? customData.folio_user : undefined
  if (typeof user !== 'string' || !/^[1-9]\d{0,15}$/.test(user)) return null
  const id = Number(user)
  return Number.isSafeInteger(id) ? id : null
}

export function subscriptionRow(entity: unknown, prices: { founding: string }, eventAt: Date): MappedSubscription {
  if (!isObject(entity)) return { ok: false, reason: 'invalid' }
  const id = idOf(entity.id, 'sub')
  const items = Array.isArray(entity.items) ? entity.items.filter(isObject) : []
  const price = items.map((item) => item.price).find(isObject)
  const priceId = price ? idOf(price.id, 'pri') : null
  const cycle = [price?.billing_cycle, entity.billing_cycle].find(isObject)
  const interval = cycle?.interval
  if (!id || !priceId || (interval !== 'month' && interval !== 'year')) return { ok: false, reason: 'invalid' }
  if (typeof entity.status !== 'string') return { ok: false, reason: 'invalid' }
  if (!isBillingStatus(entity.status))
    return { ok: false, reason: 'unknown_status', status: entity.status.slice(0, 40) }

  const period = isObject(entity.current_billing_period) ? entity.current_billing_period : null
  const change = isObject(entity.scheduled_change) ? entity.scheduled_change : null
  return {
    ok: true,
    row: {
      id,
      userId: folioUser(entity.custom_data),
      customerId: idOf(entity.customer_id, 'ctm'),
      priceId,
      cadence: interval,
      founding: priceId === prices.founding,
      status: entity.status,
      periodEndsAt: dateOf(period?.ends_at),
      cancelAt: change?.action === 'cancel' ? dateOf(change.effective_at) : null,
      canceledAt: dateOf(entity.canceled_at),
      createdAt: dateOf(entity.created_at),
      eventAt,
    },
  }
}
