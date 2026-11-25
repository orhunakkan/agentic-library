import '@tanstack/react-start/server-only'
import type { RatingErrorCode, RatingState } from '~/shared/ratings/ratings'
import { noStoreJson } from '../auth.ts'
import { openBook } from '../books/book.ts'
import { refFor } from '../books/ref.ts'
import { signedInEndpoints, signedInRead } from '../signed-in.ts'
import { parseRating } from './input.ts'
import { clearRating, getRating, setRating } from './store.ts'

const MAX_BODY_BYTES = 1024

const ratings = signedInEndpoints<RatingErrorCode>({ maxBytes: MAX_BODY_BYTES })

export const handleRating = (request: Request) =>
  ratings.post(request, { log: 'rating', parse: parseRating }, async ({ session, db, input }) => {
    const found = await openBook(db, session.userId, input.book)
    if (!found) return ratings.fail(404, 'not_found')
    const result =
      input.stars === null
        ? await clearRating(db, session.userId, found.ref)
        : await setRating(db, session.userId, found.ref, input.stars)
    if (result === 'missing') return ratings.fail(404, 'not_found')
    return noStoreJson(200, { book: input.book, stars: input.stars })
  })

export async function ratingState(request: Request, slug: string): Promise<RatingState> {
  return signedInRead(
    request,
    'rating read',
    async ({ session, db }) => ({ state: 'ready', stars: await getRating(db, session.userId, refFor(slug)) }),
    { signedOut: { state: 'hidden' } },
  )
}
