import { withoutMarkers } from '~/shared/ask/events'
import { BACK_MAX, CARD_ORIGINS, type CardOrigin, FRONT_MAX } from '~/shared/flashcards/limits'
import type { ReviewResult } from '~/shared/flashcards/schedule'
import type { PagePosition } from '~/shared/highlights/page-text'
import { clean, isObject, only, parsePosition } from '../ask/input.ts'
import { isBookSlug } from '../book-ref/ref.ts'

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

const isOrigin = (value: unknown): value is CardOrigin => CARD_ORIGINS.some((o) => o === value)

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
