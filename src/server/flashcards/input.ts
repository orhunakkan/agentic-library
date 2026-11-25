import { withoutMarkers } from '~/shared/ask/events'
import { type PagePosition, parsePosition } from '~/shared/content/position'
import { BACK_MAX, CARD_ORIGINS, type CardOrigin, FRONT_MAX } from '~/shared/flashcards/limits'
import type { ReviewResult } from '~/shared/flashcards/schedule'
import { isBookSlug } from '../../shared/content/book-slug.ts'
import { isObject, isOneOf, only } from '../../shared/lib/json-shape.ts'
import { clean } from '../ask/input.ts'

export interface NewCardInput {
  book: string
  front: string
  back: string
  position: PagePosition
  origin: CardOrigin
}

const length = (text: string) => [...text].length

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const cleaned = clean(withoutMarkers(value))
  return cleaned && length(cleaned) <= max ? cleaned : null
}

const isOrigin = (value: unknown): value is CardOrigin => isOneOf(value, CARD_ORIGINS)

export function parseNewCard(value: unknown): NewCardInput | null {
  if (!isObject(value) || !only(value, ['book', 'front', 'back', 'position', 'origin'])) return null
  const position = parsePosition(value.position)
  const front = text(value.front, FRONT_MAX)
  const back = text(value.back, BACK_MAX)
  if (!isBookSlug(value.book) || !position || !front || !back || !isOrigin(value.origin)) return null
  return { book: value.book, front, back, position, origin: value.origin }
}

export type CardChange = { review: ReviewResult } | { delete: true }

export function parseCardChange(value: unknown): CardChange | null {
  if (!isObject(value)) return null
  if (only(value, ['review']) && (value.review === 'again' || value.review === 'good')) return { review: value.review }
  if (only(value, ['delete']) && value.delete === true) return { delete: true }
  return null
}
