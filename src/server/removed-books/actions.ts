import '@tanstack/react-start/server-only'
import type { RemovedBookErrorCode, RemovedBooksState } from '~/shared/removed-books/contract'
import { noStoreJson } from '../auth.ts'
import { catalogueBook } from '../repository.ts'
import { signedInEndpoints, signedInRead } from '../signed-in.ts'
import { parseRemovedBook } from './input.ts'
import { listRemoved, setRemoved } from './store.ts'

const MAX_BODY_BYTES = 1024

const removedBooks = signedInEndpoints<RemovedBookErrorCode>({ maxBytes: MAX_BODY_BYTES })

const NOTHING: ReadonlySet<string> = new Set()

export const handleRemovedBook = (request: Request) =>
  removedBooks.post(request, { log: 'removed book', parse: parseRemovedBook }, async ({ session, db, input }) => {
    if (!(await catalogueBook(input.book))) return removedBooks.fail(404, 'not_found')
    await setRemoved(db, session.userId, input.book, input.removed)
    return noStoreJson(200, { book: input.book, removed: input.removed })
  })

export const removedBooksState = (request: Request): Promise<RemovedBooksState> =>
  signedInRead(request, 'removed books', async ({ session, db }) => ({
    state: 'ready',
    books: await listRemoved(db, session.userId),
  }))

export async function libraryExclusionsFor(request: Request): Promise<ReadonlySet<string>> {
  const state = await removedBooksState(request)
  return state.state === 'ready' ? new Set(state.books) : NOTHING
}
