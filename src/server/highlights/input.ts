import { type PagePosition, parsePosition } from '~/shared/content/position'
import { type HighlightColor, isHighlightColor } from '~/shared/highlights/colors'
import { MAX_NOTE, MAX_PASSAGE } from '~/shared/highlights/limits'
import { cleanText } from '~/shared/import/blocks'
import { isBookSlug } from '../../shared/content/book-slug.ts'
import { isObject, only } from '../../shared/lib/json-shape.ts'

const OFFSET_MAX = 10_000_000

export interface CreateInput {
  book: string
  position: PagePosition
  start: number
  end: number
  text: string
  color: HighlightColor
  note: string | null
}

export type UpdateInput = { intent: 'update'; color?: HighlightColor; note?: string | null } | { intent: 'delete' }

const length = (text: string) => [...text].length

const isOffset = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= OFFSET_MAX

function note(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return undefined
  const text = cleanText(value, true).trim()
  if (length(text) > MAX_NOTE) return undefined
  return text || null
}

export function parseCreate(value: unknown): CreateInput | null {
  if (!isObject(value) || !only(value, ['book', 'position', 'start', 'end', 'text', 'color', 'note'])) return null
  const position = parsePosition(value.position)
  const { book, start, end, text, color } = value
  if (!isBookSlug(book) || !position || !isOffset(start) || !isOffset(end) || start >= end) return null
  if (typeof text !== 'string' || !text || !text.isWellFormed() || length(text) > MAX_PASSAGE) return null
  if (!isHighlightColor(color)) return null
  const cleaned = note(value.note)
  if (cleaned === undefined) return null
  return { book, position, start, end, text, color, note: cleaned }
}

export function parseUpdate(value: unknown): UpdateInput | null {
  if (!isObject(value)) return null
  if (value.intent === 'delete') return only(value, ['intent']) ? { intent: 'delete' } : null
  if (value.intent !== 'update' || !only(value, ['intent', 'color', 'note'])) return null
  if (!('color' in value) && !('note' in value)) return null
  const out: UpdateInput = { intent: 'update' }
  if ('color' in value) {
    if (!isHighlightColor(value.color)) return null
    out.color = value.color
  }
  if ('note' in value) {
    const cleaned = value.note === undefined ? undefined : note(value.note)
    if (cleaned === undefined) return null
    out.note = cleaned
  }
  return out
}
