import '@tanstack/react-start/server-only'
import type { Stars } from '~/shared/ratings/ratings'
import { onBook, ownedBook, ownsBook } from '../book-ref/book.ts'
import type { BookRef } from '../book-ref/ref.ts'
import type { Db } from '../db.ts'

export async function getRating(db: Db, userId: number, book: BookRef): Promise<Stars | null> {
  const [row] = await db<{ stars: number }[]>`
    select stars from book_ratings
    where user_id = ${userId} and ${onBook(db, book)} and ${ownedBook(db, userId, book)}`
  return row ? (row.stars as Stars) : null
}

const isForeignKeyError = (error: unknown) => (error as { code?: string }).code === '23503'

export async function setRating(db: Db, userId: number, book: BookRef, stars: Stars): Promise<'ok' | 'missing'> {
  if (book.userBookId === null) {
    await db`
      insert into book_ratings (user_id, book_slug, stars) values (${userId}, ${book.slug}, ${stars})
      on conflict (user_id, book_slug) where book_slug is not null
      do update set stars = excluded.stars, rated_at = now()`
    return 'ok'
  }
  try {
    const rows = await db`
      insert into book_ratings (user_id, user_book_id, stars)
      select ${userId}, ${book.userBookId}, ${stars}
      where ${ownedBook(db, userId, book)}
      on conflict (user_id, user_book_id) where user_book_id is not null
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
