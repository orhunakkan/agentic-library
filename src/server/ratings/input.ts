import { isStars, type RatingBody } from '~/shared/ratings/ratings'
import { isBookSlug } from '../../shared/content/book-slug.ts'
import { exactly, isObject } from '../../shared/lib/json-shape.ts'

export function parseRating(value: unknown): RatingBody | null {
  if (!isObject(value) || !exactly(value, ['book', 'stars'])) return null
  const { book, stars } = value
  if (!isBookSlug(book)) return null
  if (stars !== null && !isStars(stars)) return null
  return { book, stars }
}
