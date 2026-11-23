import { describe, expect, it } from 'vitest'
import { FOUNDING_PRICE, formatPrice, PRO_PRICE } from '../plans/pricing'
import type { SubscriptionView } from './billing'
import {
  billingProblemText,
  buyLabel,
  cadenceName,
  endedLine,
  foundingBand,
  HOME_HERO_LINE,
  offerLine,
  PAYING_QUESTIONS,
  paidLine,
  subscriptionStatusLine,
} from './copy'

const sub = (extra: Partial<SubscriptionView> = {}): SubscriptionView => ({
  cadence: 'year',
  founding: true,
  status: 'active',
  periodEndsAt: '2027-11-10T09:00:00.000Z',
  cancelAt: null,
  endedAt: null,
  ...extra,
})

describe('the paid plan’s lines', () => {
  it('name the cadence', () => {
    const whole = (cadence: 'month' | 'year', founding: boolean) => {
      const line = paidLine(cadence, founding)
      return `${line.before}${line.name}${line.after}`
    }
    expect(whole('month', false)).toBe('You’re on Pro, monthly.')
    expect(whole('year', false)).toBe('You’re on Pro, yearly.')
    expect(whole('year', true)).toBe('You’re on Pro, founding yearly.')
    expect(cadenceName('month', true)).toBe('monthly')
  })

  it('say when it renews, and for what', () => {
    expect(subscriptionStatusLine(sub())).toEqual({ kind: 'info', text: 'Renews on 10 Nov 2027 for $29.' })
    expect(subscriptionStatusLine(sub({ founding: false }))?.text).toBe('Renews on 10 Nov 2027 for $39.')
    expect(
      subscriptionStatusLine(sub({ cadence: 'month', founding: false, periodEndsAt: '2026-12-10T00:00:00Z' })),
    ).toEqual({ kind: 'info', text: 'Renews on 10 Dec 2026 for $4.99.' })
  })

  it('say when a scheduled cancel ends it', () => {
    expect(subscriptionStatusLine(sub({ cancelAt: '2027-11-10T09:00:00.000Z' }))).toEqual({
      kind: 'info',
      text: 'Ends on 10 Nov 2027. You keep Pro until then.',
    })
  })

  it('warn when a payment failed, whatever else is set', () => {
    expect(subscriptionStatusLine(sub({ status: 'past_due', cancelAt: '2027-11-10T09:00:00Z' }))).toEqual({
      kind: 'warning',
      text: 'Your last payment didn’t go through. Paddle will try again; update your card in Manage billing to keep Pro.',
    })
  })

  it('say nothing without a period', () => {
    expect(subscriptionStatusLine(sub({ periodEndsAt: null }))).toBeNull()
  })

  it('say when an ended subscription ended', () => {
    expect(endedLine('2026-11-12T10:00:00.000Z')).toBe('Your Pro subscription ended on 12 Nov 2026.')
  })
})

describe('the offer', () => {
  it('is $4.99 a month', () => {
    expect(offerLine('month', 100)).toEqual({ price: '$4.99', rest: ' a month', struck: null })
    expect(buyLabel('month', false)).toBe('Go Pro, $4.99 a month')
  })

  it('is the founding price on yearly while spots are left, with $39 struck through', () => {
    expect(offerLine('year', 100)).toEqual({
      price: '$29',
      rest: ' a year. Founding member price: yours for as long as you stay subscribed. 100 of 100 left.',
      struck: '$39',
    })
    expect(offerLine('year', 1).rest).toContain('1 of 100 left.')
    expect(buyLabel('year', true)).toBe('Go Pro, $29 a year')
  })

  it('is $39 a year once they’re gone', () => {
    expect(offerLine('year', 0)).toEqual({
      price: '$39',
      rest: ' a year, about 35% less than monthly',
      struck: null,
    })
    expect(buyLabel('year', false)).toBe('Go Pro, $39 a year')
  })

  it('takes every price from the pricing constants', () => {
    expect(offerLine('month', 0).price).toBe(formatPrice(PRO_PRICE.monthly))
    expect(offerLine('year', 0).price).toBe(formatPrice(PRO_PRICE.yearly))
    expect(offerLine('year', 5).price).toBe(formatPrice(FOUNDING_PRICE))
    expect(HOME_HERO_LINE).toBe(
      `Free to read. Pro is ${formatPrice(PRO_PRICE.monthly)} a month or ${formatPrice(PRO_PRICE.yearly)} a year.`,
    )
    expect(HOME_HERO_LINE).toBe('Free to read. Pro is $4.99 a month or $39 a year.')
  })
})

describe('the home page', () => {
  it('shows the founding band while spots are left', () => {
    expect(foundingBand(37)).toEqual({
      strong: 'Founding members: $29 a year',
      rest: ', for as long as you stay subscribed. 37 of the first 100 left.',
    })
    expect(foundingBand(0)).toBeNull()
  })

  it('answers how paying works', () => {
    expect(PAYING_QUESTIONS.map((q) => q.q)).toEqual(['How does paying work?', 'What happens if I stop paying?'])
    expect(PAYING_QUESTIONS[0]?.a).toContain('refunded within 14 days')
  })
})

describe('the refusals', () => {
  it('have a sentence each', () => {
    expect(billingProblemText('subscribed')).toBe('You already have Pro.')
    expect(billingProblemText('pro')).toBe('You already have Pro.')
    expect(billingProblemText('failed')).toBe('Couldn’t open the checkout. Try again in a moment.')
    expect(billingProblemText('network')).toBe('Couldn’t open the checkout. Try again in a moment.')
    expect(billingProblemText('invalid')).toBe('Couldn’t open the checkout. Try again in a moment.')
    expect(billingProblemText('signed_out')).toBe('Your session has ended. Sign in again.')
    expect(billingProblemText('not_found')).toBe('There’s no subscription to manage on this account.')
  })
})
