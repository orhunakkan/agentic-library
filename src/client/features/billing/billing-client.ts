import {
  type BillingProblem,
  type Cadence,
  type CheckoutAnswer,
  isBillingProblem,
  type PlanState,
} from '~/shared/billing/billing'
import { type ChangeResult, post } from '../../lib/post'

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
  const answer = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (response.ok) {
    const value = pick(answer)
    return value === undefined ? { ok: false, problem: 'failed' } : { ok: true, value }
  }
  return { ok: false, problem: isBillingProblem(answer.error) ? answer.error : 'failed' }
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
    return body.plan === 'pro' || body.plan === 'free' ? (body as PlanState) : null
  } catch {
    return null
  }
}
