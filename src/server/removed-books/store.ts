import '@tanstack/react-start/server-only'
import type { Db } from '../db.ts'

export async function listRemoved(db: Db, userId: number): Promise<string[]> {
  const rows = await db<{ book_slug: string }[]>`select book_slug from removed_books where user_id = ${userId}`
  return rows.map((r) => r.book_slug)
}

export async function setRemoved(db: Db, userId: number, slug: string, removed: boolean): Promise<void> {
  if (removed) {
    await db`
      insert into removed_books (user_id, book_slug) values (${userId}, ${slug})
      on conflict (user_id, book_slug) do nothing`
  } else {
    await db`delete from removed_books where user_id = ${userId} and book_slug = ${slug}`
  }
}
