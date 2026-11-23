import { CONTEXT_UNITS } from './limits.ts'
import type { BookPage } from './page-text.ts'

export interface Anchor {
  chapter: string | null
  page: number
  start: number
  end: number
  exact: string
  prefix: string
  suffix: string
}

export type Resolved = { status: 'ok' | 'moved'; pageIndex: number; start: number; end: number } | { status: 'missing' }

export const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff
const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff

export function contextAt(text: string, start: number, end: number): { exact: string; prefix: string; suffix: string } {
  let from = Math.max(0, start - CONTEXT_UNITS)
  if (from > 0 && isLow(text.charCodeAt(from))) from++
  let to = Math.min(text.length, end + CONTEXT_UNITS)
  if (to < text.length && isHigh(text.charCodeAt(to - 1))) to--
  return { exact: text.slice(start, end), prefix: text.slice(from, start), suffix: text.slice(end, to) }
}

function commonSuffix(a: string, b: string): number {
  let n = 0
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++
  return n
}

function commonPrefix(a: string, b: string): number {
  let n = 0
  while (n < a.length && n < b.length && a[n] === b[n]) n++
  return n
}

function occurrences(text: string, exact: string): number[] {
  const at: number[] = []
  for (let i = text.indexOf(exact); i >= 0; i = text.indexOf(exact, i + 1)) at.push(i)
  return at
}

interface Candidate {
  pageIndex: number
  start: number
  score: number
  distance: number
  offset: number
}

function better(a: Candidate, b: Candidate | null): boolean {
  if (!b) return true
  if (a.score !== b.score) return a.score > b.score
  if (a.distance !== b.distance) return a.distance < b.distance
  return a.offset < b.offset
}

export function resolve(anchor: Anchor, pages: readonly BookPage[]): Resolved {
  if (!anchor.exact) return { status: 'missing' }
  const stored = pages.findIndex((p) => p.chapterSlug === anchor.chapter && p.page === anchor.page)
  const home = pages[stored]
  if (home && home.text.slice(anchor.start, anchor.end) === anchor.exact) {
    return { status: 'ok', pageIndex: stored, start: anchor.start, end: anchor.end }
  }

  const inChapter = (i: number) =>
    anchor.chapter !== null
      ? pages[i]?.chapterSlug === anchor.chapter
      : home !== undefined && pages[i]?.chapterIndex === home.chapterIndex
  const distance = (i: number) => {
    if (stored >= 0) return Math.abs(i - stored)
    return inChapter(i) ? Math.abs((pages[i]?.page ?? 0) - anchor.page) : 0
  }

  const all = pages.map((_, i) => i)
  const tiers = [stored >= 0 ? [stored] : [], all.filter((i) => i !== stored && inChapter(i)), all]
  for (const tier of tiers) {
    let best: Candidate | null = null
    for (const pageIndex of tier) {
      const text = (pages[pageIndex] as BookPage).text
      for (const start of occurrences(text, anchor.exact)) {
        const end = start + anchor.exact.length
        const before = text.slice(Math.max(0, start - anchor.prefix.length), start)
        const after = text.slice(end, end + anchor.suffix.length)
        const candidate = {
          pageIndex,
          start,
          score: commonSuffix(before, anchor.prefix) + commonPrefix(after, anchor.suffix),
          distance: distance(pageIndex),
          offset: Math.abs(start - anchor.start),
        }
        if (better(candidate, best)) best = candidate
      }
    }
    if (best)
      return { status: 'moved', pageIndex: best.pageIndex, start: best.start, end: best.start + anchor.exact.length }
  }
  return { status: 'missing' }
}
