import { type ChangeResult, post } from '~/client/features/highlights/highlights-client'
import type { ShelfView } from '~/shared/shelves/contract'

export type ShelfProblem =
  | 'signed_out'
  | 'not_found'
  | 'duplicate'
  | 'quota_shelves'
  | 'quota_books'
  | 'invalid'
  | 'failed'
  | 'offline'

export type ShelfResult<T> = ChangeResult<T, ShelfProblem>

const PROBLEMS: Record<string, ShelfProblem> = {
  signed_out: 'signed_out',
  not_found: 'not_found',
  duplicate: 'duplicate',
  invalid: 'invalid',
}

async function readShelfAnswer<T>(
  response: Response,
  pick: (body: Record<string, unknown>) => T | undefined,
): Promise<ShelfResult<T>> {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (response.ok) {
    const value = pick(body)
    return value === undefined ? { ok: false, problem: 'failed' } : { ok: true, value }
  }
  if (body.error === 'quota') return { ok: false, problem: body.scope === 'shelves' ? 'quota_shelves' : 'quota_books' }
  const code = body.error
  const known = typeof code === 'string' && Object.hasOwn(PROBLEMS, code) ? PROBLEMS[code] : undefined
  return { ok: false, problem: known ?? 'failed' }
}

async function send<T>(
  path: string,
  body: unknown,
  pick: (body: Record<string, unknown>) => T | undefined,
): Promise<ShelfResult<T>> {
  let response: Response
  try {
    response = await post(path, body)
  } catch {
    return { ok: false, problem: 'offline' }
  }
  return readShelfAnswer(response, pick)
}

const shelfOf = (body: Record<string, unknown>) =>
  body.shelf && typeof body.shelf === 'object' ? (body.shelf as ShelfView) : undefined

const shelfPath = (id: string) => `/account/shelves/${encodeURIComponent(id)}`

export function createShelf(name: string, book?: string): Promise<ShelfResult<ShelfView>> {
  return send('/account/shelves/new', book === undefined ? { name } : { name, book }, shelfOf)
}

export function renameShelf(id: string, name: string): Promise<ShelfResult<ShelfView>> {
  return send(shelfPath(id), { name }, shelfOf)
}

export function deleteShelf(id: string): Promise<ShelfResult<true>> {
  return send(shelfPath(id), { intent: 'delete' }, (b) => (b.deleted === true ? true : undefined))
}

export function setShelfBook(id: string, book: string, on: boolean): Promise<ShelfResult<ShelfView>> {
  return send(`${shelfPath(id)}/books`, { book, on }, shelfOf)
}
