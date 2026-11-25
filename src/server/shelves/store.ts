import '@tanstack/react-start/server-only'
import { MAX_SHELF_BOOKS_PER_USER, MAX_SHELVES_PER_USER } from '~/shared/shelves/shelves'
import { isUuid } from '../../shared/uuid.ts'
import { onBook, onReadableBook, ownsBook } from '../books/book.ts'
import { type BookRef, bookOf } from '../books/ref.ts'
import { type Db, isUniqueViolation, type Pool } from '../db.ts'

export interface ShelfRow {
  id: string
  name: string
  books: BookRef[]
}

export interface ShelfName {
  name: string
  key: string
}

interface RawShelf {
  id: string
  name: string
}

interface RawBook {
  shelf_id: string
  book_slug: string | null
  user_book_id: string | null
}

const NAME_KEY_CONSTRAINT = 'shelves_user_id_name_key_key'

function bookRows(db: Db, userId: number, shelfId: string | null) {
  return db<RawBook[]>`
    select sb.shelf_id, sb.book_slug, sb.user_book_id
    from shelf_books sb
    where sb.user_id = ${userId}
      ${shelfId === null ? db`` : db`and sb.shelf_id = ${shelfId}`}
      and ${onReadableBook(db, userId, 'sb')}
    order by sb.added_at desc, sb.book_slug, sb.user_book_id`
}

function withBooks(shelves: readonly RawShelf[], rows: readonly RawBook[]): ShelfRow[] {
  const books = new Map<string, BookRef[]>()
  for (const row of rows) {
    const list = books.get(row.shelf_id)
    if (list) list.push(bookOf(row))
    else books.set(row.shelf_id, [bookOf(row)])
  }
  return shelves.map((s) => ({ id: s.id, name: s.name, books: books.get(s.id) ?? [] }))
}

export async function listShelves(db: Db, userId: number): Promise<ShelfRow[]> {
  const [shelves, rows] = await Promise.all([
    db<RawShelf[]>`select id, name from shelves where user_id = ${userId}`,
    bookRows(db, userId, null),
  ])
  return withBooks(shelves, rows)
}

async function shelfOf(db: Db, userId: number, id: string): Promise<ShelfRow | null> {
  const [shelf] = await db<RawShelf[]>`select id, name from shelves where id = ${id} and user_id = ${userId}`
  if (!shelf) return null
  const [row] = withBooks([shelf], await bookRows(db, userId, id))
  return row ?? null
}

async function shelfBookCount(db: Db, userId: number): Promise<number> {
  const [row] = await db<{ n: string }[]>`select count(*) as n from shelf_books where user_id = ${userId}`
  return Number(row?.n ?? 0)
}

export type CreateResult = ShelfRow | 'limit-shelves' | 'duplicate' | 'missing' | 'limit-books'

export function createShelf(pool: Pool, userId: number, name: ShelfName, book: BookRef | null): Promise<CreateResult> {
  return pool.begin(async (tx): Promise<CreateResult> => {
    await tx`select id from users where id = ${userId} for update`
    const [count] = await tx<{ n: string }[]>`select count(*) as n from shelves where user_id = ${userId}`
    if (Number(count?.n ?? 0) >= MAX_SHELVES_PER_USER) return 'limit-shelves'
    if (book) {
      if (!(await ownsBook(tx, userId, book))) return 'missing'
      if ((await shelfBookCount(tx, userId)) >= MAX_SHELF_BOOKS_PER_USER) return 'limit-books'
    }
    const [shelf] = await tx<RawShelf[]>`
      insert into shelves (user_id, name, name_key) values (${userId}, ${name.name}, ${name.key})
      on conflict (user_id, name_key) do nothing
      returning id, name`
    if (!shelf) return 'duplicate'
    if (!book) return { id: shelf.id, name: shelf.name, books: [] }
    await tx`
      insert into shelf_books (shelf_id, user_id, book_slug, user_book_id)
      values (${shelf.id}, ${userId}, ${book.slug}, ${book.userBookId})`
    return { id: shelf.id, name: shelf.name, books: [book] }
  })
}

export async function renameShelf(
  db: Db,
  userId: number,
  id: string,
  name: ShelfName,
): Promise<ShelfRow | 'missing' | 'duplicate'> {
  if (!isUuid(id)) return 'missing'
  try {
    const [renamed] = await db`
      update shelves set name = ${name.name}, name_key = ${name.key}
      where id = ${id} and user_id = ${userId}
      returning id`
    if (!renamed) return 'missing'
  } catch (error) {
    if (isUniqueViolation(error, NAME_KEY_CONSTRAINT)) return 'duplicate'
    throw error
  }
  return (await shelfOf(db, userId, id)) ?? 'missing'
}

export async function deleteShelf(db: Db, userId: number, id: string): Promise<true | 'missing'> {
  if (!isUuid(id)) return 'missing'
  const result = await db`delete from shelves where id = ${id} and user_id = ${userId}`
  return result.count > 0 ? true : 'missing'
}

export function setShelfBook(
  pool: Pool,
  userId: number,
  id: string,
  book: BookRef,
  on: boolean,
): Promise<ShelfRow | 'missing' | 'limit-books'> {
  if (!isUuid(id)) return Promise.resolve('missing')
  return pool.begin(async (tx): Promise<ShelfRow | 'missing' | 'limit-books'> => {
    await tx`select id from users where id = ${userId} for update`
    const [shelf] = await tx`select 1 from shelves where id = ${id} and user_id = ${userId}`
    if (!shelf) return 'missing'
    if (!on) {
      await tx`delete from shelf_books where shelf_id = ${id} and user_id = ${userId} and ${onBook(tx, book)}`
    } else {
      if (!(await ownsBook(tx, userId, book))) return 'missing'
      const [already] = await tx`
        select 1 from shelf_books where shelf_id = ${id} and user_id = ${userId} and ${onBook(tx, book)}`
      if (!already) {
        if ((await shelfBookCount(tx, userId)) >= MAX_SHELF_BOOKS_PER_USER) return 'limit-books'
        await tx`
          insert into shelf_books (shelf_id, user_id, book_slug, user_book_id)
          values (${id}, ${userId}, ${book.slug}, ${book.userBookId})
          on conflict do nothing`
      }
    }
    return (await shelfOf(tx, userId, id)) ?? 'missing'
  })
}
