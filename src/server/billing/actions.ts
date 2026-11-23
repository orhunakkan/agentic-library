import '@tanstack/react-start/server-only'
import {
  type BillingOffer,
  type BillingProblem,
  type Cadence,
  type CheckoutAnswer,
  FOUNDING_LIMIT,
  foundingLeft,
  isCadence,
  isProStatus,
  type PlanState,
  type SubscriptionView,
} from '~/shared/billing/billing'
import { isObject, only } from '../ask/input.ts'
import { recordEvent } from '../audit.ts'
import { noStoreJson, requestIp } from '../auth.ts'
import { getConfig } from '../config.ts'
import { type Db, getDb, isDatabaseConfigured } from '../db.ts'
import { planUsage } from '../plans/plan.ts'
import { logError } from '../redact.ts'
import type { SessionUser } from '../sessions.ts'
import { signedInEndpoints, signedInRead } from '../signed-in.ts'
import { createTransaction, PaddleApiError, type PaddleOptions, portalSession } from './paddle-api.ts'
import { foundingCount, type StoredSubscription, subscriptionFor } from './store.ts'

const MAX_BODY_BYTES = 1024

const plans = signedInEndpoints<BillingProblem>({ maxBytes: MAX_BODY_BYTES })
const { fail } = plans

export function parseCheckout(value: unknown): { cadence: Cadence } | null {
  if (!isObject(value) || !only(value, ['cadence']) || !isCadence(value.cadence)) return null
  return { cadence: value.cadence }
}

async function checkoutEmail(db: Db, userId: number): Promise<string | null> {
  const [row] = await db<{ email: string }[]>`
    select email from users
    where id = ${userId} and email is not null and email_verified_at is not null and email_bounced_at is null`
  return row?.email ?? null
}

async function orBadGateway(context: string, work: () => Promise<Response>): Promise<Response> {
  try {
    return await work()
  } catch (error) {
    if (!(error instanceof PaddleApiError)) throw error
    logError(context, error)
    return fail(502, 'failed')
  }
}

export async function handleCheckout(request: Request, options: Pick<PaddleOptions, 'fetch'> = {}): Promise<Response> {
  const billing = getConfig().billing
  if (!billing) return fail(404, 'not_found')
  return plans.post(request, { log: 'billing checkout', parse: parseCheckout }, ({ session, db, input }) =>
    orBadGateway('billing checkout', async () => {
      const { userId } = session
      const current = await subscriptionFor(db, userId)
      if (current && isProStatus(current.status)) return fail(409, 'subscribed')
      if (session.plan === 'pro') return fail(409, 'pro')
      const founding = input.cadence === 'year' && (await foundingCount(db)) < FOUNDING_LIMIT
      const price =
        input.cadence === 'month' ? billing.prices.monthly : founding ? billing.prices.founding : billing.prices.yearly
      const transactionId = await createTransaction(price, userId, options)
      await recordEvent(db, 'billing.checkout', {
        userId,
        ip: requestIp(request),
        detail: { cadence: input.cadence, founding },
      })
      const answer: CheckoutAnswer = {
        transactionId,
        clientToken: billing.clientToken,
        env: billing.env,
        email: await checkoutEmail(db, userId),
      }
      return noStoreJson(200, answer)
    }),
  )
}

export async function handlePortal(request: Request, options: Pick<PaddleOptions, 'fetch'> = {}): Promise<Response> {
  if (!getConfig().billing) return fail(404, 'not_found')
  return plans.post(request, { log: 'billing portal', body: 'none' }, ({ session, db }) =>
    orBadGateway('billing portal', async () => {
      const subscription = await subscriptionFor(db, session.userId)
      if (!subscription?.customerId) return fail(404, 'not_found')
      return noStoreJson(200, { url: await portalSession(subscription.customerId, subscription.id, options) })
    }),
  )
}

function toView(sub: StoredSubscription): SubscriptionView {
  const ended = sub.status === 'canceled'
  return {
    cadence: sub.cadence,
    founding: sub.founding,
    status: sub.status,
    periodEndsAt: ended ? null : (sub.periodEndsAt?.toISOString() ?? null),
    cancelAt: ended ? null : (sub.cancelAt?.toISOString() ?? null),
    endedAt: ended ? (sub.canceledAt ?? sub.eventAt).toISOString() : null,
  }
}

export async function planStateFor(session: SessionUser): Promise<PlanState> {
  const db = getDb()
  const billing = getConfig().billing !== null
  const [usage, subscription, founders] = await Promise.all([
    planUsage(db, session.userId),
    subscriptionFor(db, session.userId),
    billing ? foundingCount(db) : Promise.resolve(FOUNDING_LIMIT),
  ])
  return {
    billing,
    plan: session.plan,
    source: usage?.source ?? (session.plan === 'pro' ? 'given' : 'free'),
    subscription: subscription && toView(subscription),
    foundingLeft: foundingLeft(founders),
  }
}

export const handlePlanState = (request: Request): Promise<Response> =>
  signedInRead(request, 'billing state', async ({ session }) => noStoreJson(200, await planStateFor(session)), {
    signedOut: fail(401, 'signed_out'),
    unavailable: fail(500, 'failed'),
  })

const OFFER_TTL_MS = 60_000
let offer: { at: number; value: BillingOffer } | null = null

export async function billingOffer(now = Date.now()): Promise<BillingOffer> {
  if (!getConfig().billing || !isDatabaseConfigured()) return { on: false, foundingLeft: 0 }
  if (offer && now - offer.at < OFFER_TTL_MS) return offer.value
  try {
    offer = { at: now, value: { on: true, foundingLeft: foundingLeft(await foundingCount(getDb())) } }
    return offer.value
  } catch (error) {
    logError('billing offer', error)
    return { on: true, foundingLeft: 0 }
  }
}

export function forgetBillingOffer(): void {
  offer = null
}
