export const MIN_STARS = 1
export const MAX_STARS = 5

export type Stars = 1 | 2 | 3 | 4 | 5

export const STAR_VALUES: readonly Stars[] = [1, 2, 3, 4, 5]

export function isStars(value: unknown): value is Stars {
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_STARS && value <= MAX_STARS
}

export interface RatingBody {
  book: string
  stars: Stars | null
}

export type RatingErrorCode = 'signed_out' | 'not_found' | 'invalid' | 'failed'

export type RatingState = { state: 'hidden' } | { state: 'unavailable' } | { state: 'ready'; stars: Stars | null }
