import { isBookSlug, isPrivateBookSlug } from '../content/book-slug'
import { coverUrlFor } from '../content/library'
import type { ReaderContext } from '../content/reader-view'
import type { BookContent, BookMeta, Catalog, CoverStyle } from '../content/schema'
import type { SpeechBook } from '../read-aloud/speech-text'

export const OFFLINE_BOOK_VERSION = 1

export const OFFLINE_NAV_URL = '/offline/nav.json'

export interface OfflineBook {
  v: typeof OFFLINE_BOOK_VERSION
  slug: string
  version: string
  title: string
  author: string
  owner: string | null
  context: ReaderContext
  content: BookContent
  cover: CoverStyle
  speech: SpeechBook
  pictures: string[]
  bytes: number
}

const VERSION = /^[0-9a-f]{16}$/
const KEYS = [
  'v',
  'slug',
  'version',
  'title',
  'author',
  'owner',
  'context',
  'content',
  'cover',
  'speech',
  'pictures',
  'bytes',
]

/** A book slug that can name an offline copy: `nav` is taken by the nav file beside them. */
export const isOfflineSlug = (value: unknown): value is string => isBookSlug(value) && value !== 'nav'

export const offlineBookUrl = (slug: string) => `/offline/${slug}.json`

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const isSitePath = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && value.length <= 500

export function parseOfflineBook(value: unknown): OfflineBook | null {
  if (!isObject(value)) return null
  const keys = Object.keys(value)
  if (keys.length !== KEYS.length || !KEYS.every((k) => keys.includes(k))) return null
  const { v, slug, version, title, author, owner, context, content, cover, speech, pictures, bytes } = value
  if (v !== OFFLINE_BOOK_VERSION || !isOfflineSlug(slug)) return null
  if (typeof version !== 'string' || !VERSION.test(version)) return null
  if (typeof title !== 'string' || typeof author !== 'string') return null
  if (isPrivateBookSlug(slug) ? typeof owner !== 'string' || owner === '' : owner !== null) return null
  if (!isObject(context) || !isObject(context.meta) || context.meta.slug !== slug || !isObject(context.catalog))
    return null
  if (!isObject(content) || content.slug !== slug || !Array.isArray(content.chapters)) return null
  if (content.kind !== 'chapter' && (content.kind !== 'paged' || !Array.isArray(content.pages))) return null
  if (!isObject(cover) || !isObject(speech) || speech.slug !== slug) return null
  if (!Array.isArray(pictures) || !pictures.every(isSitePath)) return null
  if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 0) return null
  return value as unknown as OfflineBook
}

export function trimCatalog(catalog: Catalog, meta: BookMeta): Catalog {
  const series = catalog.series.filter((s) => s.slug === meta.seriesSlug)
  const collections = catalog.collections.filter((c) => series.some((s) => s.collectionSlug === c.slug))
  return { collections, series, books: [meta] }
}

export function offlineCoverUrl(context: ReaderContext): string | null {
  const url = context.image?.src ?? context.coverUrl ?? coverUrlFor(context.meta)
  return isSitePath(url) ? url : null
}
