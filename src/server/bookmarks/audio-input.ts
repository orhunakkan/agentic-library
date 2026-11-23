import type { PagePosition } from '~/shared/highlights/page-text'
import { isBookSlug } from '../../shared/content/book-slug.ts'
import { isObject, only, parsePosition } from '../ask/input.ts'

export type AudioBookmarkCreateInput =
  | { book: string; kind: 'voice'; position: PagePosition; offset: number }
  | { book: string; kind: 'episode'; episode: string; positionMs: number }

const MAX_OFFSET = 100_000
const MAX_POSITION_MS = 86_400_000

const wholeIn = (value: unknown, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max

export function parseAudioBookmarkCreate(value: unknown): AudioBookmarkCreateInput | null {
  if (!isObject(value) || !isBookSlug(value.book)) return null
  if (value.kind === 'voice') {
    if (!only(value, ['book', 'kind', 'position', 'offset'])) return null
    const position = parsePosition(value.position)
    if (!position || !wholeIn(value.offset, MAX_OFFSET)) return null
    return { book: value.book, kind: 'voice', position, offset: value.offset }
  }
  if (value.kind === 'episode') {
    if (!only(value, ['book', 'kind', 'episode', 'positionMs'])) return null
    const { episode } = value
    if (typeof episode !== 'string' || episode.length < 1 || episode.length > 200) return null
    if (!wholeIn(value.positionMs, MAX_POSITION_MS)) return null
    return { book: value.book, kind: 'episode', episode, positionMs: value.positionMs }
  }
  return null
}

export function parseAudioBookmarkChange(value: unknown): { intent: 'delete' } | null {
  return isObject(value) && only(value, ['intent']) && value.intent === 'delete' ? { intent: 'delete' } : null
}
