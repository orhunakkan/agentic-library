import type { AskPosition } from '~/shared/ask/events'
import { isPromptId } from '~/shared/ask-prompts/prompts'
import { cleanText } from '~/shared/import/blocks'

export const QUESTION_MAX = 2_000
export const QUOTE_MAX = 1_000
export const HISTORY_TURNS_MAX = 10
export const HISTORY_CHARS_MAX = 16_000
const PAGE_MAX = 100_000
const CHAPTER_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const ASK_ACTIONS = ['explain', 'summary', 'recap', 'define', 'quiz', 'flashcards'] as const
export type AskAction = (typeof ASK_ACTIONS)[number]

const isAction = (value: unknown): value is AskAction => ASK_ACTIONS.some((action) => action === value)

const ABOUT_THE_PAGES: readonly AskAction[] = ['summary', 'recap', 'quiz', 'flashcards']

export const isStudyAction = (action: AskAction | null): action is 'quiz' | 'flashcards' =>
  action === 'quiz' || action === 'flashcards'

export interface AskTurn {
  role: 'user' | 'assistant'
  text: string
}

export interface AskInput {
  position: AskPosition
  wholeBook: boolean
  question: string
  quote: string | null
  history: AskTurn[]
  highlights: boolean
  action: AskAction | null
  prompt: string | null
  spoken: boolean
}

const length = (text: string) => [...text].length

export const clean = (text: string) => cleanText(text, true).trim()

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const only = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every((k) => keys.includes(k))

const isPage = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= PAGE_MAX

export function parsePosition(value: unknown): AskPosition | null {
  if (!isObject(value)) return null
  if ('printedPage' in value) {
    return only(value, ['printedPage']) && isPage(value.printedPage) ? { printedPage: value.printedPage } : null
  }
  if (!only(value, ['chapter', 'page'])) return null
  const { chapter, page } = value
  if (typeof chapter !== 'string' || chapter.length > 200 || !CHAPTER_SLUG.test(chapter) || !isPage(page)) return null
  return { chapter, page }
}

function history(value: unknown): AskTurn[] | null {
  if (!Array.isArray(value) || value.length > HISTORY_TURNS_MAX) return null
  const turns: AskTurn[] = []
  let total = 0
  for (const turn of value) {
    if (!isObject(turn) || !only(turn, ['role', 'text'])) return null
    if ((turn.role !== 'user' && turn.role !== 'assistant') || typeof turn.text !== 'string') return null
    const text = clean(turn.text)
    if (!text) return null
    total += length(text)
    turns.push({ role: turn.role, text })
  }
  return total <= HISTORY_CHARS_MAX ? turns : null
}

export function parseAskInput(value: unknown): AskInput | null {
  if (
    !isObject(value) ||
    !only(value, ['position', 'wholeBook', 'question', 'quote', 'history', 'highlights', 'action', 'prompt', 'spoken'])
  )
    return null
  const where = parsePosition(value.position)
  if (!where || typeof value.wholeBook !== 'boolean' || typeof value.question !== 'string') return null
  const question = clean(value.question)
  if (!question || length(question) > QUESTION_MAX) return null
  if (value.quote !== null && value.quote !== undefined && typeof value.quote !== 'string') return null
  const quote = typeof value.quote === 'string' ? clean(value.quote) : ''
  if (length(quote) > QUOTE_MAX) return null
  const turns = history(value.history ?? [])
  if (!turns) return null
  if (value.highlights !== undefined && typeof value.highlights !== 'boolean') return null
  if (value.action !== undefined && !isAction(value.action)) return null
  const action = isAction(value.action) ? value.action : null
  if ((action === 'explain' || action === 'define') && !quote) return null
  if (action && ABOUT_THE_PAGES.includes(action) && quote) return null
  if (action && value.highlights === true) return null
  if (value.prompt !== undefined && !isPromptId(value.prompt)) return null
  const prompt = typeof value.prompt === 'string' ? value.prompt : null
  if (prompt && (action || value.highlights === true)) return null
  if (value.spoken !== undefined && value.spoken !== true) return null
  const spoken = value.spoken === true
  if (spoken && (action || prompt || value.highlights === true)) return null
  return {
    position: where,
    wholeBook: value.wholeBook,
    question,
    quote: quote || null,
    history: turns,
    highlights: value.highlights === true,
    action,
    prompt,
    spoken,
  }
}
