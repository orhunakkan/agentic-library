import { isBookSlug } from '../content/book-slug.ts'
import { endpoint } from '../lib/endpoint.ts'
import { isObject, only } from '../lib/json-shape.ts'
import { cleanShelfName } from './shelves.ts'

export interface ShelfView {
  id: string
  name: string
  books: string[]
}

export interface ShelfCreateBody {
  name: string
  book?: string
}

export type ShelfChangeBody = { name: string } | { intent: 'delete' }

export interface ShelfBookBody {
  book: string
  on: boolean
}

export interface ShelfAnswer {
  shelf: ShelfView
}

export interface ShelfDeletedAnswer {
  deleted: true
}

export type ShelfErrorCode = 'signed_out' | 'not_found' | 'invalid' | 'duplicate' | 'quota' | 'failed'

export type ShelfErrorAnswer =
  | { error: Exclude<ShelfErrorCode, 'quota'> }
  | { error: 'quota'; scope: 'shelves' | 'shelf_books'; max: number }

export type ShelvesState = { state: 'signed_out' } | { state: 'unavailable' } | { state: 'ready'; shelves: ShelfView[] }

const RAW_NAME_MAX = 200

function name(value: unknown): string | null {
  return typeof value === 'string' && value.length <= RAW_NAME_MAX ? cleanShelfName(value) : null
}

export interface ShelfCreateInput {
  name: string
  book: string | null
}

export function parseShelfCreate(value: unknown): ShelfCreateInput | null {
  if (!isObject(value) || !only(value, ['name', 'book'])) return null
  const cleaned = name(value.name)
  if (!cleaned) return null
  if (value.book === undefined) return { name: cleaned, book: null }
  return isBookSlug(value.book) ? { name: cleaned, book: value.book } : null
}

export type ShelfChangeInput = { kind: 'rename'; name: string } | { kind: 'delete' }

export function parseShelfChange(value: unknown): ShelfChangeInput | null {
  if (!isObject(value)) return null
  if (only(value, ['intent']) && value.intent === 'delete') return { kind: 'delete' }
  if (!only(value, ['name'])) return null
  const cleaned = name(value.name)
  return cleaned ? { kind: 'rename', name: cleaned } : null
}

export interface ShelfBookInput {
  book: string
  on: boolean
}

export function parseShelfBook(value: unknown): ShelfBookInput | null {
  if (!isObject(value) || !only(value, ['book', 'on'])) return null
  return isBookSlug(value.book) && typeof value.on === 'boolean' ? { book: value.book, on: value.on } : null
}

const shelfPath = (id: string) => `/account/shelves/${encodeURIComponent(id)}`

/** Makes a shelf, with a book on it when one is named. */
export const SHELF_CREATE = endpoint<ShelfCreateBody, ShelfAnswer, ShelfErrorAnswer>()({
  path: '/account/shelves/new',
  parse: parseShelfCreate,
})

/** Renames one shelf, or deletes it. */
export const shelfChange = (id: string) =>
  endpoint<ShelfChangeBody, ShelfAnswer | ShelfDeletedAnswer, ShelfErrorAnswer>()({
    path: shelfPath(id),
    parse: parseShelfChange,
  })

/** Puts a book on one shelf, or takes it off. */
export const shelfBook = (id: string) =>
  endpoint<ShelfBookBody, ShelfAnswer, ShelfErrorAnswer>()({ path: `${shelfPath(id)}/books`, parse: parseShelfBook })
