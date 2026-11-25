import '@tanstack/react-start/server-only'
import { randomInt } from 'node:crypto'
import { type CitationLink, citationMarker, cleanModelText } from '~/shared/ask/events'

export const QUIZ_COUNT = 5
export const QUIZ_MIN = 3
export const CARDS_COUNT = 8
export const CARDS_MIN = 4
export const CARDS_MAX = 10
export const QUESTION_CHARS = 300
export const CHOICE_CHARS = 200
export const WHY_CHARS = 600
export const FRONT_CHARS = 200
export const BACK_CHARS = 500

export type StudyCitation = CitationLink & { pageIndex: number }

export interface StudyBlock {
  text: string
  citations: StudyCitation[]
}

export type StudyKind = 'quiz' | 'cards'

export interface ReadQuestion {
  question: string
  choices: [string, string, string, string]
  answer: 0 | 1 | 2 | 3
  why: string
  citations: StudyCitation[]
}

export interface ReadCard {
  front: string
  back: string
  citations: StudyCitation[]
}

export type StudyRead = { questions: ReadQuestion[] } | { cards: ReadCard[] }

export type Rng = (n: number) => number

const chars = (text: string) => [...text].length

type Field = 'question' | 'answer' | 'why' | 'front' | 'back' | 'A' | 'B' | 'C' | 'D'

const LABEL = /^\s*(?:\*\*)?\s*(question|answer|why|front|back)\s*(?:\*\*)?\s*:\s*(?:\*\*)?\s*(.*)$/i
const CHOICE = /^\s*(?:\*\*)?\s*([a-d])\s*(?:\*\*)?\s*[.)]\s*(?:\*\*)?\s*(.*)$/i
const FIELDS: Record<StudyKind, readonly string[]> = { quiz: ['question', 'answer', 'why'], cards: ['front', 'back'] }
const FIRST: Record<StudyKind, Field> = { quiz: 'question', cards: 'front' }

function labelOf(line: string, kind: StudyKind): { field: Field; rest: string } | null {
  const label = LABEL.exec(line)
  if (label) {
    const field = (label[1] as string).toLowerCase()
    return FIELDS[kind].includes(field) ? { field: field as Field, rest: label[2] as string } : null
  }
  if (kind !== 'quiz') return null
  const choice = CHOICE.exec(line)
  return choice ? { field: (choice[1] as string).toUpperCase() as Field, rest: choice[2] as string } : null
}

const tidy = (text: string) => cleanModelText(text).replace(/\*\*/g, '').replace(/\s+/g, ' ').trim()

interface RawItem {
  start: number
  end: number
  fields: Map<Field, string>
  repeated: boolean
}

function items(text: string, kind: StudyKind): RawItem[] {
  const found: RawItem[] = []
  let item: RawItem | null = null
  let open: Field | null = null
  let offset = 0
  for (const line of text.split('\n')) {
    const at = offset
    offset += line.length + 1
    if (!line.trim()) {
      open = null
      continue
    }
    const label = labelOf(line, kind)
    if (label?.field === FIRST[kind]) {
      if (item) item.end = at
      item = { start: at, end: text.length, fields: new Map(), repeated: false }
      found.push(item)
    }
    if (!item) continue
    if (label) {
      if (item.fields.has(label.field)) item.repeated = true
      item.fields.set(label.field, label.rest)
      open = label.field
    } else if (open) {
      item.fields.set(open, `${item.fields.get(open) ?? ''}\n${line}`)
    }
  }
  return found
}

function answerIndex(value: string): 0 | 1 | 2 | 3 | null {
  const match = /^\s*\(?([a-d])\b/i.exec(value.replace(/\*\*/g, ''))
  return match ? ('abcd'.indexOf((match[1] as string).toLowerCase()) as 0 | 1 | 2 | 3) : null
}

const within = (text: string | undefined, max: number): text is string =>
  text !== undefined && text.length > 0 && chars(text) <= max

const withMarkers = (text: string, citations: readonly StudyCitation[]) =>
  `${text}${citations.map((_, i) => citationMarker(i)).join('')}`

function question(item: RawItem, citations: StudyCitation[], rng: Rng): ReadQuestion | null {
  const questionText = tidy(item.fields.get('question') ?? '')
  const why = tidy(item.fields.get('why') ?? '')
  const choices = (['A', 'B', 'C', 'D'] as const).map((letter) => tidy(item.fields.get(letter) ?? ''))
  const answer = answerIndex(item.fields.get('answer') ?? '')
  if (item.repeated || answer === null || !within(questionText, QUESTION_CHARS) || !within(why, WHY_CHARS)) return null
  if (!choices.every((c) => within(c, CHOICE_CHARS))) return null
  if (new Set(choices.map((c) => c.toLowerCase())).size !== 4) return null
  const order = [0, 1, 2, 3]
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng(i + 1)
    ;[order[i], order[j]] = [order[j] as number, order[i] as number]
  }
  return {
    question: questionText,
    choices: order.map((i) => choices[i] as string) as ReadQuestion['choices'],
    answer: order.indexOf(answer) as ReadQuestion['answer'],
    why: withMarkers(why, citations),
    citations,
  }
}

function card(item: RawItem, citations: StudyCitation[]): ReadCard | null {
  const front = tidy(item.fields.get('front') ?? '')
  const back = tidy(item.fields.get('back') ?? '')
  if (item.repeated || !within(front, FRONT_CHARS) || !within(back, BACK_CHARS)) return null
  return { front, back: withMarkers(back, citations), citations }
}

export function readStudy(blocks: readonly StudyBlock[], kind: StudyKind, rng: Rng = randomInt): StudyRead | null {
  let text = ''
  const starts: number[] = []
  for (const block of blocks) {
    const own = block.text.replace(/\r\n?/g, '\n')
    starts.push(text.length + own.length - own.trimStart().length)
    text += own
  }
  const raw = items(text, kind)
  const citationsOf = (item: RawItem) => {
    const out: StudyCitation[] = []
    blocks.forEach((block, i) => {
      const at = starts[i] as number
      if (at < item.start || at >= item.end) return
      for (const c of block.citations) {
        if (!out.some((o) => o.pageHref === c.pageHref && o.citedText === c.citedText)) out.push(c)
      }
    })
    return out
  }
  if (kind === 'quiz') {
    const questions = raw
      .map((item) => question(item, citationsOf(item), rng))
      .filter((q) => q !== null)
      .slice(0, QUIZ_COUNT)
    return questions.length >= QUIZ_MIN ? { questions } : null
  }
  const cards = raw
    .map((item) => card(item, citationsOf(item)))
    .filter((c) => c !== null)
    .slice(0, CARDS_MAX)
  return cards.length >= CARDS_MIN ? { cards } : null
}
