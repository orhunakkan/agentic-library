import '@tanstack/react-start/server-only'
import { MAX_HIGHLIGHTS_PER_BOOK, MAX_HIGHLIGHTS_PER_USER } from '../../shared/highlights/limits.ts'
import { isUuid } from '../../shared/uuid.ts'
import { type Capped, type CappedRaw, insertCapped, onBook } from '../books/book.ts'
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

const COLUMNS = [
  'id',
  'chapter',
  'page',
  'start_offset',
  'end_offset',
  'exact',
  'prefix',
  'suffix',
  'color',
  'note',
  'created_at',
  'updated_at',
] as const

const WITH_BOOK = [...COLUMNS, 'book_slug', 'user_book_id'] as const

type Raw = CappedRaw<'highlights', (typeof COLUMNS)[number]>

type RawWithBook = CappedRaw<'highlights', (typeof WITH_BOOK)[number]>

const toRow = (highlight: Raw): HighlightRow => ({
  id: highlight.id,
  chapter: highlight.chapter,
  page: highlight.page,
  start: highlight.start_offset,
  end: highlight.end_offset,
  exact: highlight.exact,
  prefix: highlight.prefix,
  suffix: highlight.suffix,
  color: highlight.color,
  note: highlight.note,
  createdAt: highlight.created_at,
  updatedAt: highlight.updated_at,
})

export type CreateResult = Capped<HighlightRow>

export function createHighlight(
  pool: Pool,
  userId: number,
  book: BookRef,
  row: NewHighlight,
  limits: { perBook: number; perUser: number } = { perBook: MAX_HIGHLIGHTS_PER_BOOK, perUser: MAX_HIGHLIGHTS_PER_USER },
): Promise<CreateResult> {
  return insertCapped(pool, userId, book, {
    table: 'highlights',
    limits,
    values: {
      chapter: row.chapter,
      page: row.page,
      start_offset: row.start,
      end_offset: row.end,
      exact: row.exact,
      prefix: row.prefix,
      suffix: row.suffix,
      color: row.color,
      note: row.note,
    },
    returning: COLUMNS,
    toRow,
  })
}

export async function listForBook(db: Db, userId: number, book: BookRef): Promise<HighlightRow[]> {
  const rows = await db<Raw[]>`
    select ${db(COLUMNS)} from highlights
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
  const [row] = await db<RawWithBook[]>`
    select ${db(WITH_BOOK)} from highlights where id = ${id} and user_id = ${userId}`
  return row ? { ...toRow(row), book: bookOf(row) } : null
}

export async function updateHighlight(
  db: Db,
  userId: number,
  id: string,
  change: { color?: string; note?: string | null },
): Promise<(HighlightRow & { book: BookRef }) | null> {
  if (!isHighlightId(id) || (change.color === undefined && change.note === undefined)) return null
  const [row] = await db<RawWithBook[]>`
    update highlights set
      color = coalesce(${change.color ?? null}, color),
      note = ${change.note === undefined ? db`note` : change.note},
      updated_at = now()
    where id = ${id} and user_id = ${userId}
    returning ${db(WITH_BOOK)}`
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
  return rows.map((bookSummary) => ({
    book: bookOf(bookSummary),
    highlights: Number(bookSummary.highlights),
    notes: Number(bookSummary.notes),
    updatedAt: bookSummary.updated_at,
  }))
}
