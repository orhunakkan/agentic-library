import { describe, expect, it } from 'vitest'
import { MAX_HIGHLIGHTS_PER_BOOK, MAX_HIGHLIGHTS_PER_USER } from '../highlights/limits.ts'
import { MAX_BOOKS } from '../import/limits.ts'
import {
  canUse,
  DEVICE_FEATURES,
  FREE_LIMITS,
  isPlan,
  isProFeature,
  limitsFor,
  PRO_FEATURE_NAMES,
  PRO_FEATURES,
  PRO_LIMITS,
  PRO_LINK,
} from './plans.ts'

describe('plans', () => {
  it('hold Free to 2 books, 50 highlights and 20 articles, and Pro to the account caps', () => {
    expect(FREE_LIMITS).toEqual({ books: 2, highlights: 50, articles: 20 })
    expect(limitsFor('free')).toEqual({ books: 2, highlightsPerBook: 50, highlightsPerUser: 50, articles: 20 })
    expect(limitsFor('pro')).toEqual({
      books: MAX_BOOKS,
      highlightsPerBook: MAX_HIGHLIGHTS_PER_BOOK,
      highlightsPerUser: MAX_HIGHLIGHTS_PER_USER,
      articles: 500,
    })
    expect(PRO_LIMITS.books).toBe(25)
  })

  it('give every Pro feature to Pro and none to Free', () => {
    for (const feature of PRO_FEATURE_NAMES) {
      expect(canUse('pro', feature)).toBe(true)
      expect(canUse('free', feature)).toBe(false)
    }
  })

  it('list every Pro feature in what Pro adds, once', () => {
    const listed = PRO_FEATURES.flatMap((f) => (f.feature ? [f.feature] : []))
    expect([...listed].sort()).toEqual([...PRO_FEATURE_NAMES].sort())
    expect(PRO_FEATURES.map((f) => f.label)).toContain('Up to 25 of your own books')
  })

  it('name the Pro features with no server gate, which must be Pro features', () => {
    expect(DEVICE_FEATURES).toEqual(['run'])
    for (const feature of DEVICE_FEATURES) expect(isProFeature(feature)).toBe(true)
  })

  it('know a plan and a feature by name', () => {
    expect(isPlan('free')).toBe(true)
    expect(isPlan('pro')).toBe(true)
    expect(isPlan('gold')).toBe(false)
    expect(isProFeature('ask')).toBe(true)
    expect(isProFeature('lookup')).toBe(false)
    expect(isProFeature(1)).toBe(false)
    expect(PRO_LINK).toBe('/account/plan')
  })
})
