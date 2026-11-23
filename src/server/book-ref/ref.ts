import { PRIVATE_SLUG } from '~/shared/content/private-book'

export type BookRef = { slug: string; userBookId: null } | { slug: null; userBookId: string }

const CATALOGUE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const isBookSlug = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 200 &&
  (PRIVATE_SLUG.test(value) || (CATALOGUE_SLUG.test(value) && !value.startsWith('u-')))

export function refFor(slug: string): BookRef {
  return PRIVATE_SLUG.test(slug) ? { slug: null, userBookId: slug.slice(2) } : { slug, userBookId: null }
}

export const slugOf = (ref: BookRef): string => ref.slug ?? `u-${ref.userBookId}`

export const bookOf = (r: { book_slug: string | null; user_book_id: string | null }): BookRef =>
  r.user_book_id ? { slug: null, userBookId: r.user_book_id } : { slug: r.book_slug as string, userBookId: null }
