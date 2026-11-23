import type { Stars } from '~/shared/ratings/ratings'
import type { RatingProblem } from './ratings-client'

export const RATING_LEGEND = 'Your rating'
export const CLEAR_RATING = 'Clear rating'
export const RATING_UNAVAILABLE = 'Your rating couldn’t be loaded.'

export const starLabel = (n: Stars) => (n === 1 ? '1 star' : `${n} stars`)

export const ratingValue = (stars: Stars | null) => (stars === null ? 'Not rated yet' : `${stars} out of 5`)

export function problemText(problem: RatingProblem): string {
  switch (problem) {
    case 'signed_out':
      return 'Your session ended.'
    case 'not_found':
      return 'This book is no longer available.'
    default:
      return 'Couldn’t save your rating. Try again.'
  }
}
