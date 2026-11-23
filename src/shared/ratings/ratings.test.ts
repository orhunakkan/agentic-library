import { describe, expect, it } from 'vitest'
import { isStars, MAX_STARS, MIN_STARS, STAR_VALUES } from './ratings'

describe('isStars', () => {
  it('takes the whole stars from one to five', () => {
    expect([1, 2, 3, 4, 5].every(isStars)).toBe(true)
    expect(STAR_VALUES).toEqual([MIN_STARS, 2, 3, 4, MAX_STARS])
  })

  it('refuses anything else', () => {
    for (const value of [0, 6, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY, '3', null, undefined, true, [3], {}]) {
      expect(isStars(value)).toBe(false)
    }
  })
})
