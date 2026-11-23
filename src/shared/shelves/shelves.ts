import { foldText } from '../lib/search.ts'
import { isUuid } from '../uuid.ts'

export const SHELF_NAME_MAX = 40
export const MAX_SHELVES_PER_USER = 50
export const MAX_SHELF_BOOKS_PER_USER = 2000
export const SHELF_KEY_MAX = 160

const length = (value: string) => [...value].length

export const shelfNameKey = (name: string): string => foldText(name)

export function cleanShelfName(raw: string): string | null {
  if (!raw.isWellFormed()) return null
  const name = raw
    .normalize('NFC')
    .replace(/\s+/gu, ' ')
    .replace(/\p{Cc}/gu, '')
    .replace(/ {2,}/g, ' ')
    .trim()
  if (length(name) < 1 || length(name) > SHELF_NAME_MAX) return null
  const key = shelfNameKey(name)
  return key && length(key) <= SHELF_KEY_MAX ? name : null
}

const PREFIX = 'shelf-'

export const shelfFilter = (id: string): string => `${PREFIX}${id}`

export function shelfIdOf(filter: string): string | null {
  if (!filter.startsWith(PREFIX)) return null
  const id = filter.slice(PREFIX.length)
  return isUuid(id) ? id : null
}
