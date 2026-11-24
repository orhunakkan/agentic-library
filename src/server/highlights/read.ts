import '@tanstack/react-start/server-only'
import type { HighlightView } from '~/shared/highlights/group'
import { openBook } from '../books/book.ts'
import { signedInRead } from '../signed-in.ts'
import { resolvedHighlights } from './resolve.ts'

export type BookHighlightsState =
  | { state: 'signed_out' }
  | { state: 'not_found' }
  | { state: 'unavailable' }
  | { state: 'ready'; highlights: HighlightView[] }

export const bookHighlightsState = (request: Request, slug: string): Promise<BookHighlightsState> =>
  signedInRead(request, 'book highlights', async ({ session, db }): Promise<BookHighlightsState> => {
    const book = await openBook(db, session.userId, slug).then((b) => (b?.format === 'text' ? b : null))
    if (!book) return { state: 'not_found' }
    return { state: 'ready', highlights: await resolvedHighlights(db, session.userId, book) }
  })
