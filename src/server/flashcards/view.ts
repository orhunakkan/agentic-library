import '@tanstack/react-start/server-only'
import { fromStored } from '~/shared/content/position'
import type { FlashcardView } from '~/shared/flashcards/contract'
import { type BookPage, pageIndexOf } from '~/shared/highlights/page-text'
import type { CardRow } from './store.ts'

export function toCardView(row: CardRow, pages: readonly BookPage[] | null): FlashcardView {
  const page = pages ? pages[pageIndexOf(pages, fromStored(row.chapter, row.page))] : undefined
  return {
    id: row.id,
    front: row.front,
    back: row.back,
    source: page ? { pageHref: page.href, label: page.label } : null,
    box: row.box,
    dueAt: row.dueAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  }
}
