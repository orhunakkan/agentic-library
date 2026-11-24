import type { BookRef } from '../../shared/content/book-slug.ts'

export { type BookRef, refFor, slugOf } from '../../shared/content/book-slug.ts'

export const bookOf = (r: { book_slug: string | null; user_book_id: string | null }): BookRef =>
  r.user_book_id ? { slug: null, userBookId: r.user_book_id } : { slug: r.book_slug as string, userBookId: null }
