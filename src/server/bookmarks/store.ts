import '@tanstack/react-start/server-only'
import { MAX_BOOKMARKS_PER_BOOK, MAX_BOOKMARKS_PER_USER } from '~/shared/bookmarks/bookmarks'
import { isUuid } from '../../shared/uuid.ts'
import { onBook, ownsBook } from '../books/book.ts'
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

export function createBookmark(pool: Pool, userId: number, book: BookRef, row: NewBookmark): Promise<CreateResult> {
  return pool.begin(async (tx): Promise<CreateResult> => {
    await tx`select id from users where id = ${userId} for update`
    if (!(await ownsBook(tx, userId, book))) return 'missing'
    const existing = async () => {
      const [found] = await tx<Raw[]>`
        select ${tx.unsafe(COLUMNS)} from bookmarks
        where user_id = ${userId} and ${onBook(tx, book)}
          and chapter is not distinct from ${row.chapter} and page = ${row.page}`
      return found ? { row: toRow(found), created: false } : null
    }
    const already = await existing()
    if (already) return already
    const [counts] = await tx<{ in_book: string; in_all: string }[]>`
      select count(*) filter (where ${onBook(tx, book)}) as in_book, count(*) as in_all
      from bookmarks where user_id = ${userId}`
    if (Number(counts?.in_book ?? 0) >= MAX_BOOKMARKS_PER_BOOK) return 'quota-book'
    if (Number(counts?.in_all ?? 0) >= MAX_BOOKMARKS_PER_USER) return 'quota-user'
    const [created] = await tx<Raw[]>`
      insert into bookmarks
        (user_id, book_slug, user_book_id, chapter, page, start_offset, end_offset, exact, prefix, suffix)
      values (${userId}, ${book.slug}, ${book.userBookId}, ${row.chapter}, ${row.page}, ${row.start}, ${row.end},
        ${row.exact}, ${row.prefix}, ${row.suffix})
      on conflict do nothing
      returning ${tx.unsafe(COLUMNS)}`
    if (created) return { row: toRow(created), created: true }
    const raced = await existing()
    if (!raced) throw new Error('insert returned no row')
    return raced
  })
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
