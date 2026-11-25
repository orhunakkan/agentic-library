import '@tanstack/react-start/server-only'
import type { HighlightView } from '~/shared/highlights/group'
import { labelsFor, openTextBook, type TextBook } from '../books/book.ts'
import { refFor } from '../books/ref.ts'
import type { Db } from '../db.ts'
import { listForBook } from './store.ts'
import { toViews } from './view.ts'

export async function resolvedHighlights(db: Db, userId: number, book: TextBook): Promise<HighlightView[]> {
  const [rows, pages] = await Promise.all([listForBook(db, userId, book.ref), book.pages()])
  return toViews(rows, pages)
}

export interface BookHighlights {
  book: {
    slug: string
    title: string
    author: string
    removed: boolean
  }
  highlights: HighlightView[]
}

export async function highlightsFor(db: Db, userId: number, slug: string): Promise<BookHighlights | null> {
  const book = await openTextBook(db, userId, slug)
  if (book) {
    return {
      book: { slug, title: book.title, author: book.author, removed: false },
      highlights: await resolvedHighlights(db, userId, book),
    }
  }
  const ref = refFor(slug)
  if (ref.slug === null) return null
  const rows = await listForBook(db, userId, ref)
  const label = rows.length ? (await labelsFor(db, userId, [ref])).get(slug) : undefined
  if (!label) return null
  return {
    book: { slug, title: label.title, author: label.author, removed: label.removed },
    highlights: toViews(rows, null),
  }
}
