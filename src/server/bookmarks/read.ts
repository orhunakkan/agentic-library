import '@tanstack/react-start/server-only'
import type { BookmarkView } from '~/shared/bookmarks/bookmarks'
import { findBook } from '../book-ref/book.ts'
import { signedInRead } from '../signed-in.ts'
import { listForBook } from './store.ts'
import { toBookmarkViews } from './view.ts'

export type BookBookmarksState =
  | { state: 'signed_out' }
  | { state: 'not_found' }
  | { state: 'unavailable' }
  | { state: 'ready'; bookmarks: BookmarkView[] }

export const bookBookmarksState = (request: Request, slug: string): Promise<BookBookmarksState> =>
  signedInRead(request, 'book bookmarks', async ({ session, db }): Promise<BookBookmarksState> => {
    const book = await findBook(db, session.userId, slug, 'text')
    if (!book) return { state: 'not_found' }
    const [rows, pages] = await Promise.all([listForBook(db, session.userId, book.ref), book.pages()])
    return { state: 'ready', bookmarks: toBookmarkViews(rows, pages) }
  })
