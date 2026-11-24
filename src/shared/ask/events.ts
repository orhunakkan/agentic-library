import type { PagePosition } from '../content/position.ts'

export interface CitationLink {
  pageHref: string
  label: string
  citedText: string
}

export interface StudySource {
  position: PagePosition
  label: string
}

export interface QuizQuestion {
  question: string
  choices: [string, string, string, string]
  answer: 0 | 1 | 2 | 3
  why: string
  citations: CitationLink[]
  source: StudySource
}

export interface CardDraft {
  front: string
  back: string
  citations: CitationLink[]
  source: StudySource
}

export type StudySpan = 'chapter' | 'two'

export type AskErrorCode = 'key_rejected' | 'billing' | 'busy' | 'too_long' | 'bad_format' | 'failed'

export type AskEvent =
  | { type: 'text'; text: string }
  | ({ type: 'citation' } & CitationLink)
  | { type: 'quiz'; span: StudySpan; questions: QuizQuestion[] }
  | { type: 'cards'; span: StudySpan; cards: CardDraft[] }
  | { type: 'done'; stop: string }
  | { type: 'error'; code: AskErrorCode }

export const MARKER_OPEN = String.fromCharCode(0xe000)
export const MARKER_CLOSE = String.fromCharCode(0xe001)

export const citationMarker = (index: number) => `${MARKER_OPEN}${index}${MARKER_CLOSE}`

const MARKER_CHARS = new RegExp(`[${MARKER_OPEN}${MARKER_CLOSE}]`, 'g')

export const cleanModelText = (text: string) => text.replace(MARKER_CHARS, '')

const MARKERS = new RegExp(`${MARKER_OPEN}\\d*${MARKER_CLOSE}`, 'g')

export const withoutMarkers = (text: string) => cleanModelText(text.replace(MARKERS, ''))
