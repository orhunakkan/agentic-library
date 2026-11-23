import { isStars, type RatingBody } from '~/shared/ratings/ratings'
import { isBookSlug } from '../../shared/content/book-slug.ts'
import { isObject, only } from '../ask/input.ts'

export function parseRating(value: unknown): RatingBody | null {
  if (!isObject(value) || !only(value, ['book', 'stars']) || !('stars' in value)) return null
  const { book, stars } = value
  if (!isBookSlug(book)) return null
  if (stars !== null && !isStars(stars)) return null
  return { book, stars }
}
