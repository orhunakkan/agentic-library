import { isPrivateBookSlug } from '../content/book-slug'
import { isObject } from '../lib/json-shape'
import { isOfflineSlug, isSitePath } from './book'

export const SUMMARY_HEADER = 'x-folio-offline'

export interface OfflineSummary {
  slug: string
  title: string
  author: string
  owner: string | null
  bytes: number
  savedAt: number
  start: string
}

export function encodeSummary(summary: OfflineSummary): string {
  const { slug, title, author, owner, bytes, savedAt, start } = summary
  return encodeURIComponent(JSON.stringify({ slug, title, author, owner, bytes, savedAt, start }))
}

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

export function decodeSummary(value: string | null): OfflineSummary | null {
  if (!value) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(decodeURIComponent(value))
  } catch {
    return null
  }
  if (!isObject(parsed)) return null
  const { slug, title, author, owner, bytes, savedAt, start } = parsed
  if (!isOfflineSlug(slug) || typeof title !== 'string' || typeof author !== 'string') return null
  if (isPrivateBookSlug(slug) ? typeof owner !== 'string' : owner !== null) return null
  if (!isCount(bytes) || !isCount(savedAt)) return null
  if (!isSitePath(start) || !(start === `/read/${slug}` || start.startsWith(`/read/${slug}/`))) return null
  return { slug, title, author, owner: owner as string | null, bytes, savedAt, start }
}
