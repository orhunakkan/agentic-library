import '@tanstack/react-start/server-only'
import { MAX_BOOKMARKS_PER_BOOK, MAX_BOOKMARKS_PER_USER } from '~/shared/bookmarks/bookmarks'
import { isUuid } from '../../shared/uuid.ts'
import { insertCapped, onBook } from '../books/book.ts'
import type { BookRef } from '../books/ref.ts'
import type { Db, Pool } from '../db.ts'

export interface BookmarkRow {
  id: string
  chapter: string | null
  page: number
  start: number
  end: number
  exact: string
  prefix: string
  suffix: string
  createdAt: Date
}

export type NewBookmark = Omit<BookmarkRow, 'id' | 'createdAt'>

interface Raw {
  id: string
  chapter: string | null
  page: number
  start_offset: number
  end_offset: number
  exact: string
  prefix: string
  suffix: string
  created_at: Date
}

const COLUMNS = 'id, chapter, page, start_offset, end_offset, exact, prefix, suffix, created_at'

const toRow = (r: Raw): BookmarkRow => ({
  id: r.id,
  chapter: r.chapter,
  page: r.page,
  start: r.start_offset,
  end: r.end_offset,
  exact: r.exact,
  prefix: r.prefix,
  suffix: r.suffix,
  createdAt: r.created_at,
})

export type CreateResult = { row: BookmarkRow; created: boolean } | 'missing' | 'quota-book' | 'quota-user'

export async function createBookmark(
  pool: Pool,
  userId: number,
  book: BookRef,
  row: NewBookmark,
): Promise<CreateResult> {
  const result = await insertCapped<Raw>(pool, userId, book, {
    table: 'bookmarks',
    limits: { perBook: MAX_BOOKMARKS_PER_BOOK, perUser: MAX_BOOKMARKS_PER_USER },
    values: {
      chapter: row.chapter,
      page: row.page,
      start_offset: row.start,
      end_offset: row.end,
      exact: row.exact,
      prefix: row.prefix,
      suffix: row.suffix,
    },
    returning: COLUMNS,
    same: { chapter: row.chapter, page: row.page },
  })
  return typeof result === 'string' ? result : { row: toRow(result.row), created: result.created }
}

export async function listForBook(db: Db, userId: number, book: BookRef): Promise<BookmarkRow[]> {
  const rows = await db<Raw[]>`
    select ${db.unsafe(COLUMNS)} from bookmarks
    where user_id = ${userId} and ${onBook(db, book)}
    order by created_at, id`
  return rows.map(toRow)
}

export async function deleteBookmark(db: Db, userId: number, id: string): Promise<boolean> {
  if (!isUuid(id)) return false
  const result = await db`delete from bookmarks where id = ${id} and user_id = ${userId}`
  return result.count > 0
}
