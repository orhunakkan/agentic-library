import { readItem, removeKeys, writeItem } from '~/client/lib/storage-keys'
import type { CardDraft, CitationLink, QuizQuestion, StudySource, StudySpan } from '~/shared/ask/events'
import { hasPrivateSlugPrefix } from '~/shared/content/book-slug'
import { parsePosition } from '~/shared/content/position'
import { isObject } from '~/shared/lib/json-shape'

export type ThreadCitation = CitationLink

export type ThreadQuestion = QuizQuestion & { picked: number | null }

export type ThreadStudy =
  | { kind: 'quiz'; span: StudySpan; questions: ThreadQuestion[] }
  | { kind: 'cards'; span: StudySpan; cards: CardDraft[] }

export interface ThreadTurn {
  role: 'user' | 'assistant'
  text: string
  citations: ThreadCitation[]
  at: number
  stopped?: true
  study?: ThreadStudy
}

export interface Thread {
  v: 1
  wholeBook: boolean
  turns: ThreadTurn[]
}

export const MAX_TURNS = 20
export const threadKey = (bookSlug: string) => `ask:${bookSlug}`
export const emptyThread = (): Thread => ({ v: 1, wholeBook: false, turns: [] })

const isString = (v: unknown): v is string => typeof v === 'string'

function citation(c: unknown): ThreadCitation | null {
  if (!isObject(c)) return null
  if (!isString(c.pageHref) || !c.pageHref.startsWith('/read/') || !isString(c.label) || !isString(c.citedText))
    return null
  return { pageHref: c.pageHref, label: c.label, citedText: c.citedText }
}

const isIndex = (v: unknown): v is 0 | 1 | 2 | 3 => v === 0 || v === 1 || v === 2 || v === 3

function all<T>(value: unknown, parse: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(value)) return null
  const out = value.map(parse)
  return out.every((item) => item !== null) ? out : null
}

const citations = (value: unknown) => all(value, citation)

function source(value: unknown): StudySource | null {
  if (!isObject(value) || !isString(value.label)) return null
  const at = parsePosition(value.position)
  return at && { position: at, label: value.label }
}

function question(value: unknown): ThreadQuestion | null {
  if (!isObject(value) || !isString(value.question) || !isString(value.why) || !isIndex(value.answer)) return null
  const { choices } = value
  if (!Array.isArray(choices) || choices.length !== 4 || !choices.every(isString)) return null
  if (value.picked !== null && !isIndex(value.picked)) return null
  const cited = citations(value.citations)
  const from = source(value.source)
  if (!cited || !from) return null
  return {
    question: value.question,
    choices: choices as ThreadQuestion['choices'],
    answer: value.answer,
    why: value.why,
    citations: cited,
    source: from,
    picked: value.picked,
  }
}

function card(value: unknown): CardDraft | null {
  if (!isObject(value) || !isString(value.front) || !isString(value.back)) return null
  const cited = citations(value.citations)
  const from = source(value.source)
  return cited && from ? { front: value.front, back: value.back, citations: cited, source: from } : null
}

function study(value: unknown): ThreadStudy | null {
  if (!isObject(value) || (value.span !== 'chapter' && value.span !== 'two')) return null
  if (value.kind === 'quiz') {
    const questions = all(value.questions, question)
    return questions?.length ? { kind: 'quiz', span: value.span, questions } : null
  }
  if (value.kind === 'cards') {
    const cards = all(value.cards, card)
    return cards?.length ? { kind: 'cards', span: value.span, cards } : null
  }
  return null
}

function turn(t: unknown): ThreadTurn | null {
  if (!isObject(t)) return null
  if ((t.role !== 'user' && t.role !== 'assistant') || !isString(t.text) || typeof t.at !== 'number') return null
  const cited = Array.isArray(t.citations) ? t.citations.map(citation).filter((c) => c !== null) : []
  const parsed = t.study === undefined ? undefined : study(t.study)
  if (parsed === null) return null
  return {
    role: t.role,
    text: t.text,
    citations: cited,
    at: t.at,
    ...(t.stopped === true ? { stopped: true } : {}),
    ...(parsed ? { study: parsed } : {}),
  }
}

export function parseThread(raw: string | null): Thread {
  try {
    const value: unknown = raw ? JSON.parse(raw) : null
    if (!isObject(value) || value.v !== 1 || !Array.isArray(value.turns)) return emptyThread()
    const turns = value.turns.map(turn).filter((t) => t !== null)
    return { v: 1, wholeBook: value.wholeBook === true, turns: turns.slice(-MAX_TURNS) }
  } catch {
    return emptyThread()
  }
}

export function loadThread(storage: Storage | null, bookSlug: string): Thread {
  return parseThread(readItem(storage, threadKey(bookSlug)))
}

export function saveThread(storage: Storage | null, bookSlug: string, thread: Thread): boolean {
  return writeItem(storage, threadKey(bookSlug), JSON.stringify({ ...thread, turns: thread.turns.slice(-MAX_TURNS) }))
}

export function clearThread(storage: Storage | null, bookSlug: string): void {
  try {
    storage?.removeItem(threadKey(bookSlug))
  } catch {}
}

export function clearPrivateThreads(storage: Storage | null): void {
  removeKeys(storage, (key) => key.startsWith(threadKey('')) && hasPrivateSlugPrefix(key.slice(threadKey('').length)))
}
