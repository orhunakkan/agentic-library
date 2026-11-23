import { describe, expect, it } from 'vitest'
import { STAR_VALUES } from '~/shared/ratings/ratings'
import { CLEAR_RATING, problemText, RATING_LEGEND, RATING_UNAVAILABLE, ratingValue, starLabel } from './rating-text'

describe('rating text', () => {
  it('names each star', () => {
    expect(STAR_VALUES.map(starLabel)).toEqual(['1 star', '2 stars', '3 stars', '4 stars', '5 stars'])
  })

  it('says the rating, or that there is none', () => {
    expect(ratingValue(null)).toBe('Not rated yet')
    expect(ratingValue(4)).toBe('4 out of 5')
    expect(ratingValue(1)).toBe('1 out of 5')
  })

  it('says what went wrong in the reader’s words', () => {
    expect(problemText('signed_out')).toBe('Your session ended.')
    expect(problemText('not_found')).toBe('This book is no longer available.')
    expect(problemText('failed')).toBe('Couldn’t save your rating. Try again.')
    expect(problemText('offline')).toBe('Couldn’t save your rating. Try again.')
  })

  it('has the control’s fixed words', () => {
    expect([RATING_LEGEND, CLEAR_RATING, RATING_UNAVAILABLE]).toEqual([
      'Your rating',
      'Clear rating',
      'Your rating couldn’t be loaded.',
    ])
  })
})
