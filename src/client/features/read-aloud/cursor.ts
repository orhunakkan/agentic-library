import { type Utterance, utterances } from '~/shared/read-aloud/sentences'
import type { SpeechChapter } from '~/shared/read-aloud/speech-text'

export type Plan = readonly (readonly Utterance[])[]

export interface Cursor {
  pageIndex: number
  utteranceIndex: number
}

export const CHARS_PER_SECOND = 15

export function planChapter(chapter: Pick<SpeechChapter, 'pages'>, lang: string): Plan {
  return chapter.pages.map((page) => utterances(page, lang))
}

export function utteranceAt(plan: Plan, cursor: Cursor): Utterance | null {
  return plan[cursor.pageIndex]?.[cursor.utteranceIndex] ?? null
}

function fromPage(plan: Plan, pageIndex: number): Cursor | null {
  for (let p = Math.max(0, pageIndex); p < plan.length; p++)
    if (plan[p]?.length) return { pageIndex: p, utteranceIndex: 0 }
  return null
}

export const first = (plan: Plan): Cursor | null => fromPage(plan, 0)

export function next(plan: Plan, cursor: Cursor): Cursor | null {
  if (cursor.utteranceIndex + 1 < (plan[cursor.pageIndex]?.length ?? 0))
    return { pageIndex: cursor.pageIndex, utteranceIndex: cursor.utteranceIndex + 1 }
  return fromPage(plan, cursor.pageIndex + 1)
}

export function prev(plan: Plan, cursor: Cursor): Cursor | null {
  if (cursor.utteranceIndex > 0) return { pageIndex: cursor.pageIndex, utteranceIndex: cursor.utteranceIndex - 1 }
  for (let p = cursor.pageIndex - 1; p >= 0; p--) {
    const length = plan[p]?.length ?? 0
    if (length) return { pageIndex: p, utteranceIndex: length - 1 }
  }
  return null
}

export function atOffset(plan: Plan, pageIndex: number, offset: number): Cursor | null {
  const page = plan[pageIndex]
  if (!page) return null
  const index = page.findIndex((u) => u.end > offset)
  return index >= 0 ? { pageIndex, utteranceIndex: index } : fromPage(plan, pageIndex + 1)
}

const length = (u: Utterance) => u.say.length

function totalChars(plan: Plan): number {
  return plan.reduce((n, page) => n + page.reduce((m, u) => m + length(u), 0), 0)
}

function charsBefore(plan: Plan, cursor: Cursor): number {
  let n = 0
  for (let p = 0; p < cursor.pageIndex; p++) for (const u of plan[p] ?? []) n += length(u)
  for (const u of (plan[cursor.pageIndex] ?? []).slice(0, cursor.utteranceIndex)) n += length(u)
  return n
}

export function fraction(plan: Plan, cursor: Cursor): number {
  const total = totalChars(plan)
  return total > 0 ? charsBefore(plan, cursor) / total : 0
}

export function atFraction(plan: Plan, f: number): Cursor | null {
  const target = Math.min(Math.max(f, 0), 1) * totalChars(plan)
  let charsSoFar = 0
  let last: Cursor | null = null
  for (const [pageIndex, page] of plan.entries()) {
    for (const [utteranceIndex, u] of page.entries()) {
      last = { pageIndex, utteranceIndex }
      if (charsSoFar + length(u) > target) return last
      charsSoFar += length(u)
    }
  }
  return last
}

export function minutesLeft(plan: Plan, cursor: Cursor, rate: number): number {
  const chars = totalChars(plan) - charsBefore(plan, cursor)
  return Math.ceil(chars / (CHARS_PER_SECOND * rate) / 60)
}

export function onLastPage(plan: Plan, cursor: Cursor): boolean {
  return fromPage(plan, cursor.pageIndex + 1) === null
}
