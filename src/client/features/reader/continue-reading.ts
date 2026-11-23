import { browserStorage } from '~/client/features/ask/thread-store'
import { syncOutbox } from '~/client/features/sync/outbox'
import { isCatalogueBookSlug, isPrivateBookSlug } from '~/shared/content/book-slug'
import { labelOf, positionOf, type ReaderView } from '~/shared/content/reader-view'
import type { PagePosition } from '~/shared/highlights/page-text'

export interface RecentReading {
  bookSlug: string
  bookTitle: string
  chapterTitle: string
  href: string
  at: number
  position?: PagePosition
  label?: string
  device?: string
}

const KEY = 'recent-reading'
export const MAX_RECENT = 50

export function upsertRecent(list: readonly RecentReading[], entry: RecentReading, max: number): RecentReading[] {
  return [entry, ...list.filter((e) => e.bookSlug !== entry.bookSlug)].slice(0, max)
}

export function inLibrary(list: readonly RecentReading[], bookSlugs: ReadonlySet<string>): RecentReading[] {
  return list.filter((e) => bookSlugs.has(e.bookSlug))
}

export function positionFromHref(href: string): PagePosition | null {
  const match = /^\/read\/([^/?#]+)\/([^/?#]+)(?:\/([1-9]\d*))?\/?$/.exec(href)
  if (!match) return null
  const [, book = '', part = '', n] = match
  if (n !== undefined) return { chapter: part, page: Number(n) }
  if (/^[1-9]\d*$/.test(part) && !isPrivateBookSlug(book)) return { printedPage: Number(part) }
  return { chapter: part, page: 1 }
}

export function readRecent(storage: Storage | null = browserStorage()): RecentReading[] {
  try {
    const value: unknown = JSON.parse(storage?.getItem(KEY) ?? '[]')
    return Array.isArray(value)
      ? (value as RecentReading[]).filter(
          (e) => typeof e?.href === 'string' && typeof e.bookSlug === 'string' && typeof e.at === 'number',
        )
      : []
  } catch {
    return []
  }
}

export function writeRecent(storage: Storage | null, entries: readonly RecentReading[]): void {
  takeLoaded(storage)
  const sorted = [...entries].sort((a, b) => b.at - a.at).slice(0, MAX_RECENT)
  try {
    storage?.setItem(KEY, JSON.stringify(sorted))
  } catch {}
}

export function placeFor(bookSlug: string, storage: Storage | null = browserStorage()): RecentReading | null {
  return readRecent(storage).find((e) => e.bookSlug === bookSlug) ?? null
}

export function clearPrivateReading(storage: Storage | null): void {
  const list = readRecent(storage)
  const kept = list.filter((e) => isCatalogueBookSlug(e.bookSlug))
  if (kept.length !== list.length) writeRecent(storage, kept)
}

export interface Visit {
  before: number
  viewedAt: number
}

const visits = new Map<string, Visit>()
let loaded: Map<string, number> | null = null

function takeLoaded(storage: Storage | null) {
  loaded ??= new Map(readRecent(storage).map((e) => [e.bookSlug, e.at]))
}

export function visitOf(bookSlug: string): Visit | null {
  return visits.get(bookSlug) ?? null
}

export function resetVisits(): void {
  visits.clear()
  loaded = null
}

export function entryFor(view: ReaderView, at: number): RecentReading {
  return {
    bookSlug: view.book.slug,
    bookTitle: view.book.title,
    chapterTitle: view.chapterTitle,
    href: view.canonicalPath,
    at,
    position: positionOf(view),
    label: labelOf(view),
  }
}

export function rememberReading(
  view: ReaderView,
  storage: Storage | null = browserStorage(),
  now: number = Date.now(),
): RecentReading {
  const list = readRecent(storage)
  const previous = list.find((e) => e.bookSlug === view.book.slug)
  const entry = entryFor(view, Math.max(now, (previous?.at ?? 0) + 1))
  takeLoaded(storage)
  const visit = visits.get(view.book.slug)
  const before = visit ? visit.before : (loaded?.get(view.book.slug) ?? 0)
  visits.set(view.book.slug, { before, viewedAt: entry.at })
  try {
    storage?.setItem(KEY, JSON.stringify(upsertRecent(list, entry, MAX_RECENT)))
  } catch {}
  if (entry.position) syncOutbox.add({ book: entry.bookSlug, position: entry.position, at: entry.at })
  return entry
}
