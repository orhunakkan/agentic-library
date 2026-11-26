import '@tanstack/react-start/server-only'
import type { BookFlashcards, FlashcardBookSummary } from '~/shared/flashcards/contract'
import { REVIEW_SESSION_MAX } from '~/shared/flashcards/limits'
import { sessionForRequest } from '../auth.ts'
import { labelRows, openTextBook } from '../books/book.ts'
import { getDb } from '../db.ts'
import { bookCards, cardBooks, dueCards } from './store.ts'
import { toCardView } from './view.ts'

export type FlashcardBooksState = { kind: 'signed_out' } | { kind: 'all'; books: FlashcardBookSummary[] }

export type BookFlashcardsState = { kind: 'signed_out' } | { kind: 'not_found' } | ({ kind: 'book' } & BookFlashcards)

async function labelled(userId: number, now: Date) {
  const db = getDb()
  return labelRows(db, userId, await cardBooks(db, userId, now), (b) => b.book)
}

export async function flashcardBooksState(request: Request, now = new Date()): Promise<FlashcardBooksState> {
  const session = await sessionForRequest(request)
  if (!session) return { kind: 'signed_out' }
  const books = await labelled(session.userId, now)
  return {
    kind: 'all',
    books: books.map(({ row: book, slug, label }) => ({
      slug,
      title: label.title,
      removed: label.removed,
      cards: book.cards,
      due: book.due,
      nextDueAt: book.nextDueAt.toISOString(),
      activeAt: book.activeAt.toISOString(),
    })),
  }
}

export async function bookFlashcardsState(
  request: Request,
  slug: string,
  now = new Date(),
): Promise<BookFlashcardsState> {
  const session = await sessionForRequest(request)
  if (!session) return { kind: 'signed_out' }
  const db = getDb()
  const book = await openTextBook(db, session.userId, slug)
  if (!book) return { kind: 'not_found' }
  const [cards, due, pages] = await Promise.all([
    bookCards(db, session.userId, book.ref),
    dueCards(db, session.userId, book.ref, now, REVIEW_SESSION_MAX),
    book.pages(),
  ])
  return {
    kind: 'book',
    book: { slug, title: book.title, href: book.href },
    cards: cards.map((c) => toCardView(c, pages)),
    due: due.map((c) => toCardView(c, pages)),
  }
}
