import '@tanstack/react-start/server-only'
import { type CardOrigin, MAX_CARDS_PER_BOOK, MAX_CARDS_PER_USER } from '~/shared/flashcards/limits'
import { nextReview, type ReviewResult } from '~/shared/flashcards/schedule'
import { isUuid } from '../../shared/uuid.ts'
import { onBook, ownsBook } from '../book-ref/book.ts'
import { type BookRef, bookOf } from '../book-ref/ref.ts'
import type { Db, Pool } from '../db.ts'

export interface CardRow {
  id: string
  book: BookRef
  chapter: string | null
  page: number
  front: string
  back: string
  origin: string
  box: number
  dueAt: Date
  reviewedAt: Date | null
  createdAt: Date
}

export type NewCard = Pick<CardRow, 'chapter' | 'page' | 'front' | 'back'> & { origin: CardOrigin }

interface Raw {
  id: string
  book_slug: string | null
  user_book_id: string | null
  chapter: string | null
  page: number
  front: string
  back: string
  origin: string
  box: number
  due_at: Date
  reviewed_at: Date | null
  created_at: Date
}

const COLUMNS = 'id, book_slug, user_book_id, chapter, page, front, back, origin, box, due_at, reviewed_at, created_at'

const toRow = (r: Raw): CardRow => ({
  id: r.id,
  book: bookOf(r),
  chapter: r.chapter,
  page: r.page,
  front: r.front,
  back: r.back,
  origin: r.origin,
  box: r.box,
  dueAt: r.due_at,
  reviewedAt: r.reviewed_at,
  createdAt: r.created_at,
})

export type SaveResult = { row: CardRow; existed: boolean } | 'missing' | 'quota-book' | 'quota-user'

export function saveCard(pool: Pool, userId: number, book: BookRef, card: NewCard): Promise<SaveResult> {
  return pool.begin(async (tx): Promise<SaveResult> => {
    await tx`select id from users where id = ${userId} for update`
    if (!(await ownsBook(tx, userId, book))) return 'missing'
    const existing = async () => {
      const [found] = await tx<Raw[]>`
        select ${tx.unsafe(COLUMNS)} from flashcards
        where user_id = ${userId} and ${onBook(tx, book)} and front = ${card.front}`
      return found ? { row: toRow(found), existed: true } : null
    }
    const already = await existing()
    if (already) return already
    const [counts] = await tx<{ in_book: string; in_all: string }[]>`
      select count(*) filter (where ${onBook(tx, book)}) as in_book, count(*) as in_all
      from flashcards where user_id = ${userId}`
    if (Number(counts?.in_book ?? 0) >= MAX_CARDS_PER_BOOK) return 'quota-book'
    if (Number(counts?.in_all ?? 0) >= MAX_CARDS_PER_USER) return 'quota-user'
    const [created] = await tx<Raw[]>`
      insert into flashcards (user_id, book_slug, user_book_id, chapter, page, front, back, origin)
      values (${userId}, ${book.slug}, ${book.userBookId}, ${card.chapter}, ${card.page}, ${card.front}, ${card.back},
        ${card.origin})
      on conflict do nothing
      returning ${tx.unsafe(COLUMNS)}`
    if (created) return { row: toRow(created), existed: false }
    const raced = await existing()
    if (!raced) throw new Error('insert returned no row')
    return raced
  })
}

export function reviewCard(
  pool: Pool,
  userId: number,
  id: string,
  result: ReviewResult,
  now: Date,
): Promise<CardRow | null> {
  if (!isUuid(id)) return Promise.resolve(null)
  return pool.begin(async (tx) => {
    const [row] = await tx<{ box: number }[]>`
      select box from flashcards where id = ${id} and user_id = ${userId} for update`
    if (!row) return null
    const next = nextReview(row.box, result, now)
    const [updated] = await tx<Raw[]>`
      update flashcards set box = ${next.box}, due_at = ${next.dueAt}, reviewed_at = ${now}
      where id = ${id} and user_id = ${userId}
      returning ${tx.unsafe(COLUMNS)}`
    return updated ? toRow(updated) : null
  })
}

export async function deleteCard(db: Db, userId: number, id: string): Promise<boolean> {
  if (!isUuid(id)) return false
  const result = await db`delete from flashcards where id = ${id} and user_id = ${userId}`
  return result.count > 0
}

export async function deleteBookCards(db: Db, userId: number, book: BookRef): Promise<number> {
  const result = await db`delete from flashcards where user_id = ${userId} and ${onBook(db, book)}`
  return result.count
}

export async function bookCards(db: Db, userId: number, book: BookRef): Promise<CardRow[]> {
  const rows = await db<Raw[]>`
    select ${db.unsafe(COLUMNS)} from flashcards
    where user_id = ${userId} and ${onBook(db, book)}
    order by created_at, id`
  return rows.map(toRow)
}

export async function dueCards(db: Db, userId: number, book: BookRef, now: Date, limit: number): Promise<CardRow[]> {
  const rows = await db<Raw[]>`
    select ${db.unsafe(COLUMNS)} from flashcards
    where user_id = ${userId} and ${onBook(db, book)} and due_at <= ${now}
    order by due_at, created_at, id
    limit ${limit}`
  return rows.map(toRow)
}

export interface CardBook {
  book: BookRef
  cards: number
  due: number
  nextDueAt: Date
  activeAt: Date
}

export async function cardBooks(db: Db, userId: number, now: Date): Promise<CardBook[]> {
  const rows = await db<
    {
      book_slug: string | null
      user_book_id: string | null
      cards: string
      due: string
      next_due_at: Date
      active_at: Date
    }[]
  >`
    select book_slug, user_book_id, count(*) as cards, count(*) filter (where due_at <= ${now}) as due,
      min(due_at) as next_due_at, max(greatest(created_at, coalesce(reviewed_at, created_at))) as active_at
    from flashcards
    where user_id = ${userId}
    group by book_slug, user_book_id
    order by 6 desc, book_slug, user_book_id`
  return rows.map((r) => ({
    book: bookOf(r),
    cards: Number(r.cards),
    due: Number(r.due),
    nextDueAt: r.next_due_at,
    activeAt: r.active_at,
  }))
}
