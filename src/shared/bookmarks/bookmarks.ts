import { type Anchor, contextAt, isHigh, type Resolved, resolve } from '../highlights/anchor.ts'
import type { BookPage } from '../highlights/page-text.ts'

export const MAX_BOOKMARKS_PER_BOOK = 1_000
export const MAX_BOOKMARKS_PER_USER = 10_000
export const OPENING_UNITS = 64

export interface BookmarkPlace {
  chapterIndex: number
  chapterTitle: string
  chapter: string | null
  page: number
  pageHref: string
  label: string
  position: number
}

export interface BookmarkView {
  id: string
  status: 'ok' | 'moved' | 'missing'
  opening: string
  place: BookmarkPlace | null
  createdAt: string
}

export type PageAnchor = Omit<Anchor, 'chapter' | 'page'>

export function openingAt(text: string, from: number): PageAnchor | null {
  if (!Number.isInteger(from) || from < 0 || from > text.length) return null
  const found = text.slice(from).search(/\S/)
  if (found < 0) return null
  const start = from + found
  let end = Math.min(text.length, start + OPENING_UNITS)
  if (end < text.length && isHigh(text.charCodeAt(end - 1))) end--
  return { start, end, ...contextAt(text, start, end) }
}

export function pageAnchor(text: string): PageAnchor {
  return openingAt(text, 0) ?? { start: 0, end: 0, exact: '', prefix: '', suffix: '' }
}

export function resolveBookmark(anchor: Anchor, pages: readonly BookPage[]): Resolved {
  if (anchor.exact) return resolve(anchor, pages)
  const stored = pages.findIndex((p) => p.chapterSlug === anchor.chapter && p.page === anchor.page)
  return stored >= 0 ? { status: 'ok', pageIndex: stored, start: 0, end: 0 } : { status: 'missing' }
}

const byAge = (a: BookmarkView, b: BookmarkView) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)

export function inReadingOrder<T extends BookmarkView>(bookmarks: readonly T[]): T[] {
  return [...bookmarks].sort((a, b) => {
    if (a.place && b.place) return a.place.position - b.place.position || byAge(a, b)
    if (a.place || b.place) return a.place ? -1 : 1
    return byAge(a, b)
  })
}

export function onPage<T extends BookmarkView>(bookmarks: readonly T[], pageHref: string): T[] {
  return bookmarks.filter((b) => b.place?.pageHref === pageHref)
}
