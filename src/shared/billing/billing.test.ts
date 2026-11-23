import { describe, expect, it } from 'vitest'
import { FOUNDING_PRICE, PRO_PRICE } from '../plans/pricing'
import {
  BILLING_STATUSES,
  FOUNDING_LIMIT,
  foundingLeft,
  isBillingProblem,
  isBillingStatus,
  isCadence,
  isProStatus,
  priceOf,
} from './billing'

describe('the statuses', () => {
  it('make Pro while active, trialing or past due, and Free while paused or canceled', () => {
    expect(BILLING_STATUSES.filter(isProStatus)).toEqual(['active', 'trialing', 'past_due'])
  })

  it('are recognised, and nothing else is', () => {
    expect(BILLING_STATUSES.every(isBillingStatus)).toBe(true)
    expect([isBillingStatus('deleted'), isBillingStatus(1), isBillingStatus(null)]).toEqual([false, false, false])
    expect([isCadence('month'), isCadence('year'), isCadence('week')]).toEqual([true, true, false])
    expect([isBillingProblem('subscribed'), isBillingProblem('quota')]).toEqual([true, false])
  })
})

describe('the founding offer', () => {
  it('counts down from 100 and stops at 0', () => {
    expect(FOUNDING_LIMIT).toBe(100)
    expect([foundingLeft(0), foundingLeft(99), foundingLeft(100), foundingLeft(103)]).toEqual([100, 1, 0, 0])
  })

  it('is a yearly price only', () => {
    expect(priceOf('month', false)).toBe(PRO_PRICE.monthly)
    expect(priceOf('month', true)).toBe(PRO_PRICE.monthly)
    expect(priceOf('year', false)).toBe(PRO_PRICE.yearly)
    expect(priceOf('year', true)).toBe(FOUNDING_PRICE)
  })
})
