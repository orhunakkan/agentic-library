import '@tanstack/react-start/server-only'
import { sessionForRequest } from '../auth.ts'
import { labelRows } from '../books/book.ts'
import { getDb } from '../db.ts'
import { type BookHighlights, highlightsFor } from './resolve.ts'
import { bookSummaries } from './store.ts'

export interface HighlightsSummary {
  slug: string
  title: string
  author: string
  removed: boolean
  highlights: number
  notes: number
  updatedAt: string
}

export type HighlightsPageState =
  | { kind: 'signed_out' }
  | { kind: 'not_found' }
  | ({ kind: 'book' } & BookHighlights)
  | { kind: 'all'; books: HighlightsSummary[] }

export async function highlightsPageState(request: Request, book: string | undefined): Promise<HighlightsPageState> {
  const session = await sessionForRequest(request)
  if (!session) return { kind: 'signed_out' }
  const db = getDb()
  if (book) {
    const found = await highlightsFor(db, session.userId, book)
    return found ? { kind: 'book', ...found } : { kind: 'not_found' }
  }
  const labelled = await labelRows(db, session.userId, await bookSummaries(db, session.userId), (s) => s.book)
  const books = labelled.map(({ row, slug, label: { title, author, removed } }): HighlightsSummary => {
    const { highlights, notes, updatedAt } = row
    return { slug, title, author, removed, highlights, notes, updatedAt: updatedAt.toISOString() }
  })
  return { kind: 'all', books }
}
