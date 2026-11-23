import '@tanstack/react-start/server-only'
import type { HighlightView } from '~/shared/highlights/group'
import { findBook } from '../book-ref/book.ts'
import { signedInRead } from '../signed-in.ts'
import { resolvedHighlights } from './resolve.ts'

export type BookHighlightsState =
  | { state: 'signed_out' }
  | { state: 'not_found' }
  | { state: 'unavailable' }
  | { state: 'ready'; highlights: HighlightView[] }

export const bookHighlightsState = (request: Request, slug: string): Promise<BookHighlightsState> =>
  signedInRead(request, 'book highlights', async ({ session, db }): Promise<BookHighlightsState> => {
    const book = await findBook(db, session.userId, slug, 'text')
    if (!book) return { state: 'not_found' }
    return { state: 'ready', highlights: await resolvedHighlights(db, session.userId, book) }
  })
