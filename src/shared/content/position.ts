import { isObject, only } from '../lib/json-shape.ts'
import type { CollectionKind } from './schema.ts'

/** Where in a book someone is: a page of a chapter, or a printed page. */
export type PagePosition = { chapter: string; page: number } | { printedPage: number }

const READER_HREF = /^\/read\/([^/?#]+)\/([^/?#]+)(?:\/([^/?#]+))?\/?$/
const WHOLE_NUMBER = /^[1-9]\d*$/

/** The parts of a reader href, `/read/<book>/<part>[/<n>]`, as the reader route takes them. */
export function readerParams(href: string): { book: string; part: string; n?: string } | null {
  const m = READER_HREF.exec(href)
  if (!m?.[1] || !m[2]) return null
  return m[3] ? { book: m[1], part: m[2], n: m[3] } : { book: m[1], part: m[2] }
}

/** Decodes a reader href; a part of all digits is a printed page only in a paged book, so an unknown kind can't read it. */
export function positionFromHref(href: string, kind: CollectionKind | null): PagePosition | null {
  const params = readerParams(href)
  if (!params) return null
  const { part, n } = params
  if (n !== undefined) return kind !== 'paged' && WHOLE_NUMBER.test(n) ? { chapter: part, page: Number(n) } : null
  if (!WHOLE_NUMBER.test(part)) return kind === 'paged' ? null : { chapter: part, page: 1 }
  if (kind === 'paged') return { printedPage: Number(part) }
  return kind === 'chapter' ? { chapter: part, page: 1 } : null
}

const PAGE_MAX = 100_000
const CHAPTER_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const CHAPTER_SLUG_MAX = 200

const isPage = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= PAGE_MAX

/** Reads a position from a request body, refusing any other shape. */
export function parsePosition(value: unknown): PagePosition | null {
  if (!isObject(value)) return null
  if ('printedPage' in value) {
    return only(value, ['printedPage']) && isPage(value.printedPage) ? { printedPage: value.printedPage } : null
  }
  if (!only(value, ['chapter', 'page'])) return null
  const { chapter, page } = value
  if (typeof chapter !== 'string' || chapter.length > CHAPTER_SLUG_MAX || !CHAPTER_SLUG.test(chapter) || !isPage(page))
    return null
  return { chapter, page }
}

/** Whether two positions name the same page. */
export const samePosition = (a: PagePosition, b: PagePosition): boolean =>
  'printedPage' in a
    ? 'printedPage' in b && a.printedPage === b.printedPage
    : 'chapter' in b && a.chapter === b.chapter && a.page === b.page

/** A string that names one position, for maps and caches: a printed page's is its number, a chapter page's has a slash. */
export const positionKey = (position: PagePosition): string =>
  'printedPage' in position ? String(position.printedPage) : `${position.chapter}/${position.page}`

/** The page number, of the chapter or the printed page. */
export const pageOf = (position: PagePosition): number =>
  'printedPage' in position ? position.printedPage : position.page

/** A position as rows and highlight places store it: a printed page has no chapter. */
export const toStored = (position: PagePosition): { chapter: string | null; page: number } =>
  'printedPage' in position
    ? { chapter: null, page: position.printedPage }
    : { chapter: position.chapter, page: position.page }

/** Reads back a stored position. */
export const fromStored = (chapter: string | null, page: number): PagePosition =>
  chapter === null ? { printedPage: page } : { chapter, page }
