import '@tanstack/react-start/server-only'
import { sessionForRequest } from '../auth.ts'
import { labelsFor } from '../books/book.ts'
import { slugOf } from '../books/ref.ts'
import { getDb } from '../db.ts'
import { highlightsFor } from './resolve.ts'
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
  | ({ kind: 'book' } & NonNullable<Awaited<ReturnType<typeof highlightsFor>>>)
  | { kind: 'all'; books: HighlightsSummary[] }

export async function highlightsPageState(request: Request, book: string | undefined): Promise<HighlightsPageState> {
  const session = await sessionForRequest(request)
  if (!session) return { kind: 'signed_out' }
  const db = getDb()
  if (book) {
    const found = await highlightsFor(db, session.userId, book)
    return found ? { kind: 'book', ...found } : { kind: 'not_found' }
  }
  const summaries = await bookSummaries(db, session.userId)
  const labels = await labelsFor(
    db,
    session.userId,
    summaries.map((s) => s.book),
  )
  const books = summaries.flatMap((s): HighlightsSummary[] => {
    const slug = slugOf(s.book)
    const label = labels.get(slug)
    if (!label) return []
    const { title, author, removed } = label
    return [
      { slug, title, author, removed, highlights: s.highlights, notes: s.notes, updatedAt: s.updatedAt.toISOString() },
    ]
  })
  return { kind: 'all', books }
}
