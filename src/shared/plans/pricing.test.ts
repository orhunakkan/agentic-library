import { describe, expect, it } from 'vitest'
import { FOUNDING_PRICE, formatPrice, PRO_PRICE, yearlySavingPercent } from './pricing'

describe('formatPrice', () => {
  it('shows cents only when there are any', () => {
    expect(formatPrice(4.99)).toBe('$4.99')
    expect(formatPrice(39)).toBe('$39')
    expect(formatPrice(0)).toBe('$0')
    expect(formatPrice(4.5)).toBe('$4.50')
    expect(formatPrice(0.1 + 0.2)).toBe('$0.30')
  })
})

describe('yearlySavingPercent', () => {
  it('is 35 for Pro, the nearest whole percent to the real saving', () => {
    const real = ((PRO_PRICE.monthly * 12 - PRO_PRICE.yearly) / (PRO_PRICE.monthly * 12)) * 100
    expect(yearlySavingPercent()).toBe(35)
    expect(Math.abs(yearlySavingPercent() - real)).toBeLessThanOrEqual(0.5)
  })

  it('is never negative, and 0 when there is no monthly price', () => {
    expect(yearlySavingPercent({ monthly: 1, yearly: 20 })).toBe(0)
    expect(yearlySavingPercent({ monthly: 0, yearly: 0 })).toBe(0)
    expect(yearlySavingPercent({ monthly: 10, yearly: 60 })).toBe(50)
  })
})

describe('the price', () => {
  it('is the one agreed with the owner', () => {
    expect(PRO_PRICE).toEqual({ monthly: 4.99, yearly: 39 })
    expect(FOUNDING_PRICE).toBe(29)
  })
})
