import '@tanstack/react-start/server-only'
import { MAX_HIGHLIGHTS_PER_BOOK, MAX_HIGHLIGHTS_PER_USER } from '../../shared/highlights/limits.ts'
import { isUuid } from '../../shared/uuid.ts'
import { onBook, ownsBook } from '../books/book.ts'
import { type BookRef, bookOf } from '../books/ref.ts'
import type { Db, Pool } from '../db.ts'

export const isHighlightId = isUuid

export interface HighlightRow {
  id: string
  chapter: string | null
  page: number
  start: number
  end: number
  exact: string
  prefix: string
  suffix: string
  color: string
  note: string | null
  createdAt: Date
  updatedAt: Date
}

export type NewHighlight = Omit<HighlightRow, 'id' | 'createdAt' | 'updatedAt'>

interface Raw {
  id: string
  chapter: string | null
  page: number
  start_offset: number
  end_offset: number
  exact: string
  prefix: string
  suffix: string
  color: string
  note: string | null
  created_at: Date
  updated_at: Date
  book_slug: string | null
  user_book_id: string | null
}

const COLUMNS =
  'id, chapter, page, start_offset, end_offset, exact, prefix, suffix, color, note, created_at, updated_at'

const toRow = (r: Raw): HighlightRow => ({
  id: r.id,
  chapter: r.chapter,
  page: r.page,
  start: r.start_offset,
  end: r.end_offset,
  exact: r.exact,
  prefix: r.prefix,
  suffix: r.suffix,
  color: r.color,
  note: r.note,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

export type CreateResult = HighlightRow | 'missing' | 'quota-book' | 'quota-user'

export function createHighlight(
  pool: Pool,
  userId: number,
  book: BookRef,
  row: NewHighlight,
  limits: { perBook: number; perUser: number } = { perBook: MAX_HIGHLIGHTS_PER_BOOK, perUser: MAX_HIGHLIGHTS_PER_USER },
): Promise<CreateResult> {
  return pool.begin(async (tx): Promise<CreateResult> => {
    await tx`select id from users where id = ${userId} for update`
    if (!(await ownsBook(tx, userId, book))) return 'missing'
    const [counts] = await tx<{ in_book: string; in_all: string }[]>`
      select count(*) filter (where ${onBook(tx, book)}) as in_book, count(*) as in_all
      from highlights where user_id = ${userId}`
    if (Number(counts?.in_all ?? 0) >= limits.perUser) return 'quota-user'
    if (Number(counts?.in_book ?? 0) >= limits.perBook) return 'quota-book'
    const [created] = await tx<Raw[]>`
      insert into highlights
        (user_id, book_slug, user_book_id, chapter, page, start_offset, end_offset, exact, prefix, suffix, color, note)
      values (${userId}, ${book.slug}, ${book.userBookId}, ${row.chapter}, ${row.page}, ${row.start}, ${row.end},
        ${row.exact}, ${row.prefix}, ${row.suffix}, ${row.color}, ${row.note})
      returning ${tx.unsafe(COLUMNS)}`
    if (!created) throw new Error('insert returned no row')
    return toRow(created)
  })
}

export async function listForBook(db: Db, userId: number, book: BookRef): Promise<HighlightRow[]> {
  const rows = await db<Raw[]>`
    select ${db.unsafe(COLUMNS)} from highlights
    where user_id = ${userId} and ${onBook(db, book)}
    order by created_at, id`
  return rows.map(toRow)
}

export async function getHighlight(
  db: Db,
  userId: number,
  id: string,
): Promise<(HighlightRow & { book: BookRef }) | null> {
  if (!isHighlightId(id)) return null
  const [row] = await db<Raw[]>`
    select ${db.unsafe(COLUMNS)}, book_slug, user_book_id from highlights where id = ${id} and user_id = ${userId}`
  return row ? { ...toRow(row), book: bookOf(row) } : null
}

export async function updateHighlight(
  db: Db,
  userId: number,
  id: string,
  change: { color?: string; note?: string | null },
): Promise<(HighlightRow & { book: BookRef }) | null> {
  if (!isHighlightId(id) || (change.color === undefined && change.note === undefined)) return null
  const [row] = await db<Raw[]>`
    update highlights set
      color = coalesce(${change.color ?? null}, color),
      note = ${change.note === undefined ? db`note` : change.note},
      updated_at = now()
    where id = ${id} and user_id = ${userId}
    returning ${db.unsafe(COLUMNS)}, book_slug, user_book_id`
  return row ? { ...toRow(row), book: bookOf(row) } : null
}

export async function deleteHighlight(db: Db, userId: number, id: string): Promise<boolean> {
  if (!isHighlightId(id)) return false
  const result = await db`delete from highlights where id = ${id} and user_id = ${userId}`
  return result.count > 0
}

export async function deleteForBook(db: Db, userId: number, book: BookRef): Promise<number> {
  const result = await db`delete from highlights where user_id = ${userId} and ${onBook(db, book)}`
  return result.count
}

export interface BookSummary {
  book: BookRef
  highlights: number
  notes: number
  updatedAt: Date
}

export async function bookSummaries(db: Db, userId: number): Promise<BookSummary[]> {
  const rows = await db<
    {
      book_slug: string | null
      user_book_id: string | null
      highlights: string
      notes: string
      updated_at: Date
    }[]
  >`
    select book_slug, user_book_id, count(*) as highlights, count(note) as notes, max(updated_at) as updated_at
    from highlights
    where user_id = ${userId}
    group by book_slug, user_book_id
    order by max(updated_at) desc, book_slug, user_book_id`
  return rows.map((r) => ({
    book: bookOf(r),
    highlights: Number(r.highlights),
    notes: Number(r.notes),
    updatedAt: r.updated_at,
  }))
}
