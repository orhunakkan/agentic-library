import '@tanstack/react-start/server-only'
import { isUuid } from '../shared/uuid.ts'
import { forgetBookAudio } from './audiobooks/files.ts'
import { recordEvent } from './audit.ts'
import type { Db, Pool } from './db.ts'
import { deleteBook } from './user-books.ts'

/**
 * The operator's tool for acting on a copyright or other legal notice: find a book by its title or author across
 * every account, and remove it. It reads titles and authors only, never a book's contents, and every search and
 * removal is recorded with its reason, as the Privacy page says. `scripts/db/books.ts` is its command line.
 */

export type BookKind = 'book' | 'audiobook' | 'article'

export interface FoundBook {
  id: string
  username: string
  kind: BookKind
  title: string
  author: string
  addedAt: Date
}

export interface RemovedBook {
  bookId: string
  title: string
  username: string
  /** The owner's confirmed address, so the operator can tell them, or null when there's none. */
  email: string | null
}

/** A missing reason or search text: the operator has to say why, and what they're looking for. */
export class OperatorInputError extends Error {
  name = 'OperatorInputError'
}

function required(value: string, what: string): string {
  const text = value.trim()
  if (!text) throw new OperatorInputError(`${what} is required`)
  return text
}

/** The shortest search text: enough to name a title or an author, never short enough to list every library. */
export const MIN_SEARCH_LENGTH = 3

/** Books, audiobooks and articles whose title or author contains `text`, ignoring case, across every account. */
export async function findBooks(db: Db, text: string, reason: string, detail: object = {}): Promise<FoundBook[]> {
  const needle = required(text, 'the search text')
  if (needle.length < MIN_SEARCH_LENGTH)
    throw new OperatorInputError(`the search text must be at least ${MIN_SEARCH_LENGTH} characters`)
  const why = required(reason, 'a reason')
  const rows = await db<
    {
      id: string
      username: string
      format: string | null
      article_url: string | null
      title: string
      author: string
      created_at: Date
    }[]
  >`
    select b.id, u.username, b.format, b.article_url, b.title, b.author, b.created_at
    from user_books b join users u on u.id = b.user_id
    where strpos(lower(b.title), lower(${needle})) > 0 or strpos(lower(b.author), lower(${needle})) > 0
    order by b.created_at, b.id`
  await recordEvent(db, 'book.searched', { detail: { ...detail, text: needle, reason: why, matches: rows.length } })
  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    kind: row.format === 'audio' ? 'audiobook' : row.article_url ? 'article' : 'book',
    title: row.title,
    author: row.author,
    addedAt: row.created_at,
  }))
}

/**
 * Deletes one reader's book exactly as their own delete does: its rows (pages and pictures go with it), then its
 * audio files. Returns who owned it, or null, changing nothing, when there's no such book.
 */
export async function removeBook(
  db: Pool,
  bookId: string,
  reason: string,
  detail: object = {},
): Promise<RemovedBook | null> {
  const why = required(reason, 'a reason')
  if (!isUuid(bookId)) return null
  /** The removal and its record go in one transaction, so there's never a removal the log doesn't show. */
  const book = await db.begin(async (tx) => {
    const [found] = await tx<
      { user_id: number; title: string; username: string; email: string | null; email_verified_at: Date | null }[]
    >`
      select b.user_id, b.title, u.username, u.email, u.email_verified_at
      from user_books b join users u on u.id = b.user_id
      where b.id = ${bookId}
      for update of b`
    if (!found) return null
    await deleteBook(tx, found.user_id, bookId)
    await recordEvent(tx, 'book.removed', {
      userId: found.user_id,
      detail: { ...detail, bookId, title: found.title, owner: found.username, reason: why },
    })
    return found
  })
  if (!book) return null
  await forgetBookAudio(book.user_id, bookId)
  return {
    bookId,
    title: book.title,
    username: book.username,
    email: book.email_verified_at ? book.email : null,
  }
}
