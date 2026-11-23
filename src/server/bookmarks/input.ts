import type { PagePosition } from '~/shared/highlights/page-text'
import { isBookSlug } from '../../shared/content/book-slug.ts'
import { isObject, only, parsePosition } from '../ask/input.ts'

export interface BookmarkCreateInput {
  book: string
  position: PagePosition
}

export function parseBookmarkCreate(value: unknown): BookmarkCreateInput | null {
  if (!isObject(value) || !only(value, ['book', 'position'])) return null
  const position = parsePosition(value.position)
  if (!isBookSlug(value.book) || !position) return null
  return { book: value.book, position }
}

export function parseBookmarkChange(value: unknown): { intent: 'delete' } | null {
  return isObject(value) && only(value, ['intent']) && value.intent === 'delete' ? { intent: 'delete' } : null
}
