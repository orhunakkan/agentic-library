import { type ChangeResult, post, readChange } from '~/client/lib/post'
import {
  BILLING_PROBLEMS,
  type BillingProblem,
  type Cadence,
  type CheckoutAnswer,
  type PlanState,
} from '~/shared/billing/billing'
import { isPlan } from '~/shared/plans/plans'

export type BillingResult<T> = ChangeResult<T, BillingProblem | 'network'>

async function send<T>(
  path: string,
  body: unknown,
  pick: (body: Record<string, unknown>) => T | undefined,
): Promise<BillingResult<T>> {
  let response: Response
  try {
    response = await post(path, body)
  } catch {
    return { ok: false, problem: 'network' }
  }
  return readChange(response, pick, BILLING_PROBLEMS)
}

const text = (value: unknown) => (typeof value === 'string' && value.length > 0 ? value : undefined)

export function startCheckout(cadence: Cadence): Promise<BillingResult<CheckoutAnswer>> {
  return send('/account/plan/checkout', { cadence }, (b) => {
    const transactionId = text(b.transactionId)
    const clientToken = text(b.clientToken)
    if (!transactionId || !clientToken || (b.env !== 'sandbox' && b.env !== 'production')) return undefined
    return { transactionId, clientToken, env: b.env, email: text(b.email) ?? null }
  })
}

export function openPortal(): Promise<BillingResult<string>> {
  return send('/account/plan/portal', {}, (b) => text(b.url))
}

export async function fetchPlanState(): Promise<PlanState | null> {
  try {
    const response = await fetch('/account/plan/state', { cache: 'no-store' })
    if (!response.ok) return null
    const body = (await response.json()) as Partial<PlanState>
    return isPlan(body.plan) ? (body as PlanState) : null
  } catch {
    return null
  }
}
