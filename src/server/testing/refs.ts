import { type BookRef, privateBookSlug, refFor } from '../../shared/content/book-slug.ts'

/** A private book's ref, built with the book slug codec and typed as the private kind, so a test can read its id. */
export function privateRef(id: string): Extract<BookRef, { slug: null }> {
  const ref = refFor(privateBookSlug(id))
  if (ref.userBookId === null) throw new Error(`${id} is not a private book id`)
  return ref
}
