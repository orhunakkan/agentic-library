import '@tanstack/react-start/server-only'
import { resolve } from '~/shared/highlights/anchor'
import { knownColor } from '~/shared/highlights/colors'
import { type HighlightView, inReadingOrder } from '~/shared/highlights/group'
import type { BookPage } from '~/shared/highlights/page-text'
import type { HighlightRow } from './store.ts'

export function toView(row: HighlightRow, pages: readonly BookPage[] | null): HighlightView {
  const found = pages ? resolve(row, pages) : ({ status: 'missing' } as const)
  const page = found.status === 'missing' ? undefined : pages?.[found.pageIndex]
  return {
    id: row.id,
    color: knownColor(row.color),
    note: row.note,
    text: row.exact,
    status: page ? found.status : 'missing',
    place:
      page && found.status !== 'missing'
        ? {
            chapterIndex: page.chapterIndex,
            chapterTitle: page.chapterTitle,
            chapter: page.chapterSlug,
            page: page.page,
            pageHref: page.href,
            href: `${page.href}#highlight-${row.id}`,
            label: page.label,
            position: found.pageIndex,
            start: found.start,
            end: found.end,
          }
        : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toViews(rows: readonly HighlightRow[], pages: readonly BookPage[] | null): HighlightView[] {
  return inReadingOrder(rows.map((row) => toView(row, pages)))
}
