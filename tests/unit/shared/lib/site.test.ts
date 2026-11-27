import { describe, expect, it } from 'vitest'
import { PRIVACY_UPDATED, shortDate, TERMS_UPDATED } from '~/shared/lib/site'

describe('the policy pages’ dates', () => {
  it('are real days, and not after today', () => {
    for (const updated of [PRIVACY_UPDATED, TERMS_UPDATED]) {
      expect(updated).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      const day = new Date(`${updated}T00:00:00Z`)
      expect(day.toISOString().slice(0, 10)).toBe(updated)
      expect(updated <= new Date().toISOString().slice(0, 10)).toBe(true)
    }
  })
})

describe('shortDate', () => {
  it('writes a day, a short month and the year', () => {
    expect(shortDate('2026-11-07')).toBe('7 Nov 2026')
    expect(shortDate(new Date('2026-01-13T23:59:59Z'))).toBe('13 Jan 2026')
    expect(shortDate('2026-12-31T08:00:00.000Z')).toBe('31 Dec 2026')
  })
})
