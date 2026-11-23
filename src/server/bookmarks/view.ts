import '@tanstack/react-start/server-only'
import { type BookmarkView, inReadingOrder, resolveBookmark } from '~/shared/bookmarks/bookmarks'
import type { BookPage } from '~/shared/highlights/page-text'
import type { BookmarkRow } from './store.ts'

export function toBookmarkView(row: BookmarkRow, pages: readonly BookPage[]): BookmarkView {
  const found = resolveBookmark(row, pages)
  const page = found.status === 'missing' ? undefined : pages[found.pageIndex]
  return {
    id: row.id,
    status: page && found.status !== 'missing' ? found.status : 'missing',
    opening: row.exact.replace(/\s+/g, ' ').trim(),
    place:
      page && found.status !== 'missing'
        ? {
            chapterIndex: page.chapterIndex,
            chapterTitle: page.chapterTitle,
            chapter: page.chapterSlug,
            page: page.page,
            pageHref: page.href,
            label: page.label,
            position: found.pageIndex,
          }
        : null,
    createdAt: row.createdAt.toISOString(),
  }
}

export function toBookmarkViews(rows: readonly BookmarkRow[], pages: readonly BookPage[]): BookmarkView[] {
  return inReadingOrder(rows.map((row) => toBookmarkView(row, pages)))
}
