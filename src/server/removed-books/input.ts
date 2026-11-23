import { isCatalogueBookSlug } from '../../shared/content/book-slug.ts'
import { isObject, only } from '../ask/input.ts'

export interface RemovedBookInput {
  book: string
  removed: boolean
}

export function parseRemovedBook(value: unknown): RemovedBookInput | null {
  if (!isObject(value) || !only(value, ['book', 'removed'])) return null
  const { book, removed } = value
  if (!isCatalogueBookSlug(book) || typeof removed !== 'boolean') return null
  return { book, removed }
}
