import '@tanstack/react-start/server-only'

import type { ShelfErrorCode, ShelvesState } from '~/shared/shelves/contract'
import { MAX_SHELF_BOOKS_PER_USER, MAX_SHELVES_PER_USER, shelfNameKey } from '~/shared/shelves/shelves'
import { isUuid } from '../../shared/uuid.ts'
import { noStoreJson } from '../auth.ts'
import { type BookRef, refFor } from '../book-ref/ref.ts'
import { catalogueBooks } from '../repository.ts'
import { signedInEndpoints, signedInRead } from '../signed-in.ts'
import { parseShelfBook, parseShelfChange, parseShelfCreate } from './input.ts'
import { createShelf, deleteShelf, listShelves, renameShelf, type ShelfRow, setShelfBook } from './store.ts'
import { type Catalogue, toShelfView, toShelfViews } from './view.ts'

export type { ShelvesState }

const MAX_BODY_BYTES = 2 * 1024

const shelves = signedInEndpoints<ShelfErrorCode>({ via: 'api', maxBytes: MAX_BODY_BYTES })
const { fail } = shelves

const QUOTA_SHELVES = () => fail(409, 'quota', { scope: 'shelves', max: MAX_SHELVES_PER_USER })
const QUOTA_BOOKS = () => fail(409, 'quota', { scope: 'shelf_books', max: MAX_SHELF_BOOKS_PER_USER })

const shelfId = (id: string) => () => (isUuid(id) ? undefined : fail(404, 'not_found'))

function bookFor(slug: string, slugs: Catalogue): BookRef | null {
  const ref = refFor(slug)
  return ref.slug !== null && !slugs.has(ref.slug) ? null : ref
}

const answer = (status: number, row: ShelfRow, slugs: Catalogue) =>
  noStoreJson(status, { shelf: toShelfView(row, slugs) })

export const handleShelfCreate = (request: Request) =>
  shelves.post(request, { log: 'shelf create', parse: parseShelfCreate }, async ({ session, db, input }) => {
    const slugs = await catalogueBooks()
    const book = input.book === null ? null : bookFor(input.book, slugs)
    if (input.book !== null && !book) return fail(404, 'not_found')
    const name = { name: input.name, key: shelfNameKey(input.name) }
    const result = await createShelf(db, session.userId, name, book)
    if (result === 'quota-shelves') return QUOTA_SHELVES()
    if (result === 'quota-books') return QUOTA_BOOKS()
    if (result === 'duplicate') return fail(409, 'duplicate')
    if (result === 'missing') return fail(404, 'not_found')
    return answer(201, result, slugs)
  })

export const handleShelfChange = (request: Request, id: string) =>
  shelves.post(
    request,
    { log: 'shelf change', before: shelfId(id), parse: parseShelfChange },
    async ({ session, db, input }) => {
      const { userId } = session
      if (input.kind === 'delete') {
        return (await deleteShelf(db, userId, id)) === true
          ? noStoreJson(200, { deleted: true })
          : fail(404, 'not_found')
      }
      const result = await renameShelf(db, userId, id, { name: input.name, key: shelfNameKey(input.name) })
      if (result === 'missing') return fail(404, 'not_found')
      if (result === 'duplicate') return fail(409, 'duplicate')
      return answer(200, result, await catalogueBooks())
    },
  )

export const handleShelfBook = (request: Request, id: string) =>
  shelves.post(
    request,
    { log: 'shelf book', before: shelfId(id), parse: parseShelfBook },
    async ({ session, db, input }) => {
      const slugs = await catalogueBooks()
      const book = bookFor(input.book, slugs)
      if (!book) return fail(404, 'not_found')
      const result = await setShelfBook(db, session.userId, id, book, input.on)
      if (result === 'missing') return fail(404, 'not_found')
      if (result === 'quota-books') return QUOTA_BOOKS()
      return answer(200, result, slugs)
    },
  )

export const shelvesState = (request: Request): Promise<ShelvesState> =>
  signedInRead(request, 'shelves', async ({ session, db }) => {
    const [rows, slugs] = await Promise.all([listShelves(db, session.userId), catalogueBooks()])
    return { state: 'ready', shelves: toShelfViews(rows, slugs) }
  })
