import { isObject, only } from '../ask/input.ts'
import { isBookSlug } from '../book-ref/ref.ts'

export interface RemovedBookInput {
  book: string
  removed: boolean
}

export function parseRemovedBook(value: unknown): RemovedBookInput | null {
  if (!isObject(value) || !only(value, ['book', 'removed'])) return null
  const { book, removed } = value
  if (!isBookSlug(book) || book.startsWith('u-') || typeof removed !== 'boolean') return null
  return { book, removed }
}
