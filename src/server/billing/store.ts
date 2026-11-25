import '@tanstack/react-start/server-only'
import { type BillingStatus, type Cadence, PRO_STATUSES } from '../../shared/billing/billing.ts'
import { recordEvent } from '../audit.ts'
import type { Db } from '../db.ts'
import type { PaddleEvent, SubscriptionRow } from './webhook-input.ts'

export async function recordPaddleEvent(tx: Db, event: PaddleEvent): Promise<boolean> {
  const rows = await tx`
    insert into paddle_events (event_id, event_type, occurred_at)
    values (${event.eventId}, ${event.eventType}, ${event.occurredAt})
    on conflict (event_id) do nothing`
  return rows.count === 1
}

export interface Upserted {
  applied: boolean
  userId: number | null
  unknownUser: boolean
  from: BillingStatus | null
  to: BillingStatus
}

export async function upsertFromPaddle(tx: Db, row: SubscriptionRow): Promise<Upserted> {
  const [before] = await tx<{ status: BillingStatus; user_id: string | null }[]>`
    select status, user_id from subscriptions where id = ${row.id} for update`
  const [known] = row.userId === null ? [] : await tx<{ id: string }[]>`select id from users where id = ${row.userId}`
  const userId = known ? Number(known.id) : null
  const [after] = await tx<{ status: BillingStatus; user_id: string | null }[]>`
    insert into subscriptions (id, user_id, customer_id, price_id, cadence, founding, status, period_ends_at,
      cancel_at, canceled_at, created_at, event_at)
    values (${row.id}, ${userId}, ${userId === null ? null : row.customerId}, ${row.priceId}, ${row.cadence},
      ${row.founding}, ${row.status}, ${row.periodEndsAt}, ${row.cancelAt}, ${row.canceledAt},
      ${row.createdAt ?? new Date()}, ${row.eventAt})
    on conflict (id) do update set
      user_id = coalesce(excluded.user_id, subscriptions.user_id),
      customer_id = case when coalesce(excluded.user_id, subscriptions.user_id) is null then null
        else coalesce(excluded.customer_id, subscriptions.customer_id) end,
      price_id = excluded.price_id,
      cadence = excluded.cadence,
      founding = excluded.founding,
      status = excluded.status,
      period_ends_at = excluded.period_ends_at,
      cancel_at = excluded.cancel_at,
      canceled_at = excluded.canceled_at,
      event_at = excluded.event_at
    where subscriptions.event_at < excluded.event_at
    returning status, user_id`
  const unknownUser = row.userId !== null && userId === null
  if (!after) {
    return {
      applied: false,
      userId: before?.user_id ? Number(before.user_id) : null,
      unknownUser,
      from: before?.status ?? null,
      to: before?.status ?? row.status,
    }
  }
  return {
    applied: true,
    userId: after.user_id ? Number(after.user_id) : null,
    unknownUser,
    from: before?.status ?? null,
    to: after.status,
  }
}

export async function recordStatusChange(
  tx: Db,
  result: Upserted,
  subscription: string,
  by: 'paddle' | 'reconcile',
): Promise<void> {
  if (result.applied && result.from !== result.to)
    await recordEvent(tx, 'billing.subscription', {
      userId: result.userId,
      detail: { subscription, status: result.to, by },
    })
}

export interface StoredSubscription {
  id: string
  customerId: string | null
  cadence: Cadence
  founding: boolean
  status: BillingStatus
  periodEndsAt: Date | null
  cancelAt: Date | null
  canceledAt: Date | null
  eventAt: Date
}

type SubscriptionDbRow = {
  id: string
  customer_id: string | null
  cadence: Cadence
  founding: boolean
  status: BillingStatus
  period_ends_at: Date | null
  cancel_at: Date | null
  canceled_at: Date | null
  event_at: Date
}

const toStored = (r: SubscriptionDbRow): StoredSubscription => ({
  id: r.id,
  customerId: r.customer_id,
  cadence: r.cadence,
  founding: r.founding,
  status: r.status,
  periodEndsAt: r.period_ends_at,
  cancelAt: r.cancel_at,
  canceledAt: r.canceled_at,
  eventAt: r.event_at,
})

export async function subscriptionFor(db: Db, userId: number): Promise<StoredSubscription | null> {
  const [row] = await db<SubscriptionDbRow[]>`
    select id, customer_id, cadence, founding, status, period_ends_at, cancel_at, canceled_at, event_at
    from subscriptions where user_id = ${userId}
    order by (status = any(${[...PRO_STATUSES]}::text[])) desc, created_at desc, event_at desc
    limit 1`
  return row ? toStored(row) : null
}

export async function billableSubscriptions(db: Db, userId: number): Promise<string[]> {
  const rows = await db<{ id: string }[]>`
    select id from subscriptions where user_id = ${userId} and status <> 'canceled' order by created_at`
  return rows.map((r) => r.id)
}

export async function foundingCount(db: Db): Promise<number> {
  const [row] = await db<{ n: string }[]>`select count(*) as n from subscriptions where founding`
  return Number(row?.n ?? 0)
}

export async function detachUser(tx: Db, userId: number): Promise<void> {
  await tx`update subscriptions set user_id = null, customer_id = null where user_id = ${userId}`
}

export async function sweepPaddleEvents(db: Db): Promise<number> {
  const rows = await db`delete from paddle_events where received_at < now() - interval '90 days'`
  return rows.count
}
