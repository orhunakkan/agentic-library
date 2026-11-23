import '@tanstack/react-start/server-only'
import type { BookFlashcards, FlashcardBookCount, FlashcardBookSummary } from '~/shared/flashcards/contract'
import { REVIEW_SESSION_MAX } from '~/shared/flashcards/limits'
import { canUse } from '~/shared/plans/plans'
import { sessionForRequest } from '../auth.ts'
import { type BookLabel, findBook, labelsFor } from '../book-ref/book.ts'
import { slugOf } from '../book-ref/ref.ts'
import { getDb } from '../db.ts'
import { bookCards, type CardBook, cardBooks, dueCards } from './store.ts'
import { toCardView } from './view.ts'

export type FlashcardsProState = { kind: 'pro'; books: FlashcardBookCount[] }

export type FlashcardBooksState =
  | { kind: 'signed_out' }
  | { kind: 'all'; books: FlashcardBookSummary[] }
  | FlashcardsProState

export type BookFlashcardsState =
  | { kind: 'signed_out' }
  | { kind: 'not_found' }
  | ({ kind: 'book' } & BookFlashcards)
  | FlashcardsProState

async function labelled(userId: number, now: Date): Promise<{ book: CardBook; slug: string; label: BookLabel }[]> {
  const db = getDb()
  const books = await cardBooks(db, userId, now)
  const labels = await labelsFor(
    db,
    userId,
    books.map((b) => b.book),
  )
  return books.flatMap((book) => {
    const slug = slugOf(book.book)
    const label = labels.get(slug)
    return label ? [{ book, slug, label }] : []
  })
}

async function counts(userId: number, now: Date): Promise<FlashcardsProState> {
  const books = await labelled(userId, now)
  return { kind: 'pro', books: books.map((b) => ({ slug: b.slug, title: b.label.title, cards: b.book.cards })) }
}

export async function flashcardBooksState(request: Request, now = new Date()): Promise<FlashcardBooksState> {
  const session = await sessionForRequest(request)
  if (!session) return { kind: 'signed_out' }
  if (!canUse(session.plan, 'flashcards')) return counts(session.userId, now)
  const books = await labelled(session.userId, now)
  return {
    kind: 'all',
    books: books.map(({ book, slug, label }) => ({
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
  if (!canUse(session.plan, 'flashcards')) return counts(session.userId, now)
  const db = getDb()
  const book = await findBook(db, session.userId, slug, 'text')
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
