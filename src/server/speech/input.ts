import { isBookSlug } from '../../shared/content/book-slug.ts'
import { type PagePosition, parsePosition } from '../../shared/content/position.ts'
import { type SpeechFormat, VOICE_ID } from '../../shared/read-aloud/cloud.ts'
import { isObject, only } from '../ask/input.ts'

const MAX_INDEX = 100_000

export type SpeakInput = { book: string; chapter: number; voice: string; format: SpeechFormat } & (
  | { kind: 'span'; position: PagePosition; start: number; end: number }
  | { kind: 'intro' }
)

const isIndex = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_INDEX

export function parseSpeakInput(value: unknown): SpeakInput | null {
  if (!isObject(value)) return null
  if (!only(value, ['book', 'chapter', 'voice', 'format', 'position', 'start', 'end', 'intro'])) return null
  const { book, chapter, voice, format = 'low' } = value
  if (!isBookSlug(book) || !isIndex(chapter)) return null
  if (typeof voice !== 'string' || !VOICE_ID.test(voice)) return null
  if (format !== 'low' && format !== 'standard') return null
  const common = { book, chapter, voice, format } as const
  const hasSpan = 'position' in value || 'start' in value || 'end' in value
  if ('intro' in value) return value.intro === true && !hasSpan ? { ...common, kind: 'intro' } : null
  const position = parsePosition(value.position)
  const { start, end } = value
  if (!position || !isIndex(start) || !isIndex(end) || start >= end) return null
  return { ...common, kind: 'span', position, start, end }
}
