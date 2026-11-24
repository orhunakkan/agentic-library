import { type CallFailure, call } from '~/client/lib/call'
import type { ChangeResult } from '~/client/lib/post'
import type { Endpoint } from '~/shared/lib/endpoint'
import {
  SHELF_CREATE,
  type ShelfAnswer,
  type ShelfDeletedAnswer,
  type ShelfErrorAnswer,
  type ShelfView,
  shelfBook,
  shelfChange,
} from '~/shared/shelves/contract'

export type ShelfProblem =
  | 'signed_out'
  | 'not_found'
  | 'duplicate'
  | 'limit_shelves'
  | 'limit_books'
  | 'invalid'
  | 'failed'
  | 'offline'

export type ShelfResult<T> = ChangeResult<T, ShelfProblem>

/** Reads a refusal as its problem; a code the endpoint doesn't send (a proxy's, a newer server's) is a failure. */
function problemOf(refusal: ShelfErrorAnswer | CallFailure): ShelfProblem {
  switch (refusal.error) {
    case 'quota':
      return refusal.scope === 'shelves' ? 'limit_shelves' : 'limit_books'
    case 'signed_out':
    case 'not_found':
    case 'invalid':
    case 'duplicate':
    case 'offline':
      return refusal.error
    default:
      return 'failed'
  }
}

async function send<B, A, T>(
  endpoint: Endpoint<B, unknown, A, ShelfErrorAnswer>,
  body: B,
  pick: (answer: A) => T | undefined,
): Promise<ShelfResult<T>> {
  const result = await call(endpoint, body)
  if (!result.ok) return { ok: false, problem: problemOf(result.refusal) }
  const value = pick(result.answer)
  return value === undefined ? { ok: false, problem: 'failed' } : { ok: true, value }
}

const shelfOf = (answer: ShelfAnswer | ShelfDeletedAnswer): ShelfView | undefined =>
  'shelf' in answer ? answer.shelf : undefined

export function createShelf(name: string, book?: string): Promise<ShelfResult<ShelfView>> {
  return send(SHELF_CREATE, book === undefined ? { name } : { name, book }, shelfOf)
}

export function renameShelf(id: string, name: string): Promise<ShelfResult<ShelfView>> {
  return send(shelfChange(id), { name }, shelfOf)
}

export function deleteShelf(id: string): Promise<ShelfResult<true>> {
  return send(shelfChange(id), { intent: 'delete' }, (answer) =>
    'deleted' in answer && answer.deleted === true ? true : undefined,
  )
}

export function setShelfBook(id: string, book: string, on: boolean): Promise<ShelfResult<ShelfView>> {
  return send(shelfBook(id), { book, on }, shelfOf)
}
