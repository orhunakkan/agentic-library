import '@tanstack/react-start/server-only'
import type { Stars } from '~/shared/ratings/ratings'
import { onBook, onBookConflict, ownedBook, ownsBook } from '../books/book.ts'
import type { BookRef } from '../books/ref.ts'
import type { Db } from '../db.ts'

export async function getRating(db: Db, userId: number, book: BookRef): Promise<Stars | null> {
  const [row] = await db<{ stars: number }[]>`
    select stars from book_ratings
    where user_id = ${userId} and ${onBook(db, book)} and ${ownedBook(db, userId, book)}`
  return row ? (row.stars as Stars) : null
}

const isForeignKeyError = (error: unknown) => (error as { code?: string }).code === '23503'

export async function setRating(db: Db, userId: number, book: BookRef, stars: Stars): Promise<'ok' | 'missing'> {
  try {
    const rows = await db`
      insert into book_ratings (user_id, book_slug, user_book_id, stars)
      select ${userId}::bigint, ${book.slug}::text, ${book.userBookId}::uuid, ${stars}::int
      where ${ownedBook(db, userId, book)}
      on conflict ${onBookConflict(db, book)}
      do update set stars = excluded.stars, rated_at = now()
      returning 1`
    return rows.length ? 'ok' : 'missing'
  } catch (error) {
    if (isForeignKeyError(error)) return 'missing'
    throw error
  }
}

export async function clearRating(db: Db, userId: number, book: BookRef): Promise<'ok' | 'missing'> {
  if (!(await ownsBook(db, userId, book))) return 'missing'
  await db`delete from book_ratings where user_id = ${userId} and ${onBook(db, book)}`
  return 'ok'
}
