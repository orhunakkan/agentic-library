import type { ReaderView } from '~/shared/content/reader-view'

export interface ColumnPage {
  href: string
  view: ReaderView
}

export interface Column {
  chapterIndex: number
  pages: ColumnPage[]
  loading: 'next' | 'prev' | null
  failed: 'next' | 'prev' | null
}

export function columnAt(view: ReaderView): Column {
  return { chapterIndex: view.chapterIndex, pages: [{ href: view.canonicalPath, view }], loading: null, failed: null }
}

export function nextHref(column: Column): string | null {
  const next = column.pages.at(-1)?.view.nav.next
  return next?.kind === 'page' ? next.href : null
}

export function prevHref(column: Column): string | null {
  const prev = column.pages[0]?.view.nav.prev
  return prev?.kind === 'page' ? prev.href : null
}

const arrivedAt = (column: Column, end: 'next' | 'prev') => ({
  loading: column.loading === end ? null : column.loading,
  failed: column.failed === end ? null : column.failed,
})

export function appended(column: Column, page: ColumnPage): Column {
  if (page.href !== nextHref(column)) return column
  return { ...column, pages: [...column.pages, page], ...arrivedAt(column, 'next') }
}

export function prepended(column: Column, page: ColumnPage): Column {
  if (page.href !== prevHref(column)) return column
  return { ...column, pages: [page, ...column.pages], ...arrivedAt(column, 'prev') }
}

export function onRouteChange(
  column: Column,
  view: ReaderView,
  causedByScroll: boolean,
): { kind: 'none' } | { kind: 'scroll'; index: number } | { kind: 'reset'; column: Column } {
  if (causedByScroll) return { kind: 'none' }
  const sameChapter = column.chapterIndex === view.chapterIndex && column.pages[0]?.view.book.slug === view.book.slug
  const index = sameChapter ? column.pages.findIndex((p) => p.href === view.canonicalPath) : -1
  return index >= 0 ? { kind: 'scroll', index } : { kind: 'reset', column: columnAt(view) }
}

export function pageAtLine(tops: readonly number[], line: number, atBottom: boolean): number {
  if (tops.length === 0) return 0
  if (atBottom) return tops.length - 1
  let at = 0
  tops.forEach((top, i) => {
    if (top <= line) at = i
  })
  return at
}

export function readerParams(href: string): { book: string; part: string; n?: string } | null {
  const m = /^\/read\/([^/?#]+)\/([^/?#]+)(?:\/([^/?#]+))?\/?$/.exec(href)
  if (!m?.[1] || !m[2]) return null
  return m[3] ? { book: m[1], part: m[2], n: m[3] } : { book: m[1], part: m[2] }
}
