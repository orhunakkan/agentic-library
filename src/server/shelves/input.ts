import { cleanShelfName } from '~/shared/shelves/shelves'
import { isBookSlug } from '../../shared/content/book-slug.ts'
import { isObject, only } from '../ask/input.ts'

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
