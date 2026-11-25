import { isOneOf } from '../lib/json-shape.ts'
import type { Plan, PlanSource } from '../plans/plans.ts'
import { FOUNDING_PRICE, PRO_PRICE } from '../plans/pricing.ts'

export type Cadence = 'month' | 'year'

export const BILLING_STATUSES = ['active', 'trialing', 'past_due', 'paused', 'canceled'] as const
export type BillingStatus = (typeof BILLING_STATUSES)[number]

export const PRO_STATUSES = ['active', 'trialing', 'past_due'] as const satisfies readonly BillingStatus[]

export const FOUNDING_LIMIT = 100

export function isCadence(value: unknown): value is Cadence {
  return value === 'month' || value === 'year'
}

export function isBillingStatus(value: unknown): value is BillingStatus {
  return isOneOf(value, BILLING_STATUSES)
}

export function isProStatus(status: BillingStatus): boolean {
  return isOneOf(status, PRO_STATUSES)
}

export function foundingLeft(count: number): number {
  return Math.max(0, FOUNDING_LIMIT - count)
}

export function priceOf(cadence: Cadence, founding: boolean): number {
  if (cadence === 'month') return PRO_PRICE.monthly
  return founding ? FOUNDING_PRICE : PRO_PRICE.yearly
}

export interface BillingOffer {
  on: boolean
  foundingLeft: number
}

export interface SubscriptionView {
  cadence: Cadence
  founding: boolean
  status: BillingStatus
  periodEndsAt: string | null
  cancelAt: string | null
  endedAt: string | null
}

export interface PlanState {
  billing: boolean
  plan: Plan
  source: PlanSource
  subscription: SubscriptionView | null
  foundingLeft: number
}

export const BILLING_PROBLEMS = ['signed_out', 'invalid', 'not_found', 'subscribed', 'pro', 'failed'] as const
export type BillingProblem = (typeof BILLING_PROBLEMS)[number]

export function isBillingProblem(value: unknown): value is BillingProblem {
  return isOneOf(value, BILLING_PROBLEMS)
}

export interface CheckoutAnswer {
  transactionId: string
  clientToken: string
  env: 'sandbox' | 'production'
  email: string | null
}
