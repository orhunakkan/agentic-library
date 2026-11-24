import { isObject } from '../lib/json-shape.ts'
import { isRunLang, type RunLang } from '../run-code/langs.ts'
import { type BookDetails, cleanDescription } from './details.ts'
import type { ImageInfo } from './image.ts'
import { normalizeIsbn } from './isbn.ts'
import {
  DESCRIPTION_MAX,
  MAX_BOOK_IMAGE_BYTES,
  MAX_BOOK_IMAGES,
  MAX_CHAPTER_BLOCKS,
  MAX_IMAGE_BYTES,
  PUBLISHER_MAX,
} from './limits.ts'

export type InlineStyle = 'em' | 'strong' | 'code' | 'sup' | 'sub'
export const INLINE_STYLES: readonly InlineStyle[] = ['em', 'strong', 'code', 'sup', 'sub']

export type Run = { text: string; style?: InlineStyle } | { br: true }

export interface ListBlock {
  type: 'list'
  ordered: boolean
  items: ListItem[]
}

export interface ListItem {
  runs: Run[]
  lists?: ListBlock[]
}

export type BookBlock =
  | { type: 'heading'; level: 3 | 4; runs: Run[] }
  | { type: 'paragraph'; runs: Run[] }
  | { type: 'blockquote'; paragraphs: Run[][] }
  | ListBlock
  | { type: 'table'; head: Run[][][]; body: Run[][][] }
  | { type: 'code'; text: string; lang?: RunLang }
  | ImageBlock

export interface ImageBlock {
  type: 'image'
  image: number
  alt: string
  caption?: Run[]
}

export interface DraftChapter {
  title: string
  blocks: BookBlock[]
}

export interface SourceCover {
  bytes: Uint8Array
  info: ImageInfo
  from: 'epub' | 'zip' | 'pdf' | 'audio'
}

export interface BookMetadata {
  title: string
  author: string
  language: string
  details: BookDetails
  cover: SourceCover | null
}

export type PictureType = ImageInfo['type'] | 'image/svg+xml'

export type SourceProblem = 'remote' | 'missing' | 'unreadable' | 'large'

export type SourcePicture =
  | { key: string; bytes: Uint8Array; type: PictureType }
  | { key: string; problem: SourceProblem }

export interface DraftBook extends BookMetadata {
  chapters: DraftChapter[]
  pictures: SourcePicture[]
}

export const TITLE_MAX = 300
export const AUTHOR_MAX = 200
export const CHAPTER_TITLE_MAX = 300
export const ALT_MAX = 1000
export const CAPTION_MAX = 2000
const RUN_TEXT_MAX = 50_000
const CODE_TEXT_MAX = 200_000
const RUNS_MAX = 5_000
const ITEMS_MAX = 5_000
const PARAGRAPHS_MAX = 1_000
const ROWS_MAX = 2_000
const CELLS_MAX = 64
export const LIST_DEPTH_MAX = 6
export const LANGUAGE_TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8}){0,4}$/

export class UploadError extends Error {
  name = 'UploadError'
  readonly code: 'invalid' | 'too-long' | 'empty'
  constructor(code: 'invalid' | 'too-long' | 'empty', detail: string) {
    super(detail)
    this.code = code
  }
}

const invalid = (detail: string) => new UploadError('invalid', detail)

const range = (from: number, to: number) => `${String.fromCharCode(from)}-${String.fromCharCode(to)}`
const CONTROL = new RegExp(
  `[${range(0, 0x1f)}${range(0x7f, 0x9f)}${range(0x202a, 0x202e)}${range(0x2066, 0x2069)}]`,
  'g',
)
const CONTROL_IN_CODE = new RegExp(
  `[${range(0, 0x08)}${range(0x0b, 0x1f)}${range(0x7f, 0x9f)}${range(0x202a, 0x202e)}${range(0x2066, 0x2069)}]`,
  'g',
)

export function cleanText(text: string, code = false): string {
  const normal = text.normalize('NFC')
  return code
    ? normal.replace(/\r\n?/g, '\n').replace(CONTROL_IN_CODE, '')
    : normal.replace(/[\t\n\r]/g, ' ').replace(CONTROL, '')
}

function shape(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!isObject(value)) throw invalid('expected an object')
  for (const key of Object.keys(value))
    if (!required.includes(key) && !optional.includes(key)) throw invalid(`unknown field "${key}"`)
  for (const key of required) if (!(key in value)) throw invalid(`missing field "${key}"`)
  return value
}

function array(value: unknown, max: number, what: string): unknown[] {
  if (!Array.isArray(value)) throw invalid(`${what} must be a list`)
  if (value.length > max) throw new UploadError('too-long', `${what}: more than ${max}`)
  return value
}

function string(value: unknown, max: number, what: string, code = false): string {
  if (typeof value !== 'string') throw invalid(`${what} must be text`)
  const text = cleanText(value, code)
  if (text.length > max) throw new UploadError('too-long', `${what}: longer than ${max} characters`)
  return text
}

function checkRun(value: unknown): Run {
  if (isObject(value) && 'br' in value) {
    const run = shape(value, ['br'])
    if (run.br !== true) throw invalid('br must be true')
    return { br: true }
  }
  const run = shape(value, ['text'], ['style'])
  const text = string(run.text, RUN_TEXT_MAX, 'text')
  if (run.style === undefined) return { text }
  const style = INLINE_STYLES.find((s) => s === run.style)
  if (!style) throw invalid(`unknown style "${String(run.style)}"`)
  return { text, style }
}

const checkRuns = (value: unknown): Run[] => array(value, RUNS_MAX, 'runs').map(checkRun)

function checkList(value: unknown, depth: number): ListBlock {
  if (depth > LIST_DEPTH_MAX) throw new UploadError('too-long', `lists nested more than ${LIST_DEPTH_MAX} deep`)
  const list = shape(value, ['type', 'ordered', 'items'])
  if (list.type !== 'list') throw invalid('nested lists must have type "list"')
  if (typeof list.ordered !== 'boolean') throw invalid('ordered must be true or false')
  const items = array(list.items, ITEMS_MAX, 'list items').map((value): ListItem => {
    const item = shape(value, ['runs'], ['lists'])
    const runs = checkRuns(item.runs)
    if (item.lists === undefined) return { runs }
    return { runs, lists: array(item.lists, ITEMS_MAX, 'nested lists').map((l) => checkList(l, depth + 1)) }
  })
  return { type: 'list', ordered: list.ordered, items }
}

const checkRows = (value: unknown, what: string): Run[][][] =>
  array(value, ROWS_MAX, what).map((row) => array(row, CELLS_MAX, 'cells').map(checkRuns))

export function checkBlock(value: unknown): BookBlock {
  if (!isObject(value)) throw invalid('expected a block')
  switch (value.type) {
    case 'heading': {
      const block = shape(value, ['type', 'level', 'runs'])
      if (block.level !== 3 && block.level !== 4) throw invalid('heading level must be 3 or 4')
      return { type: 'heading', level: block.level, runs: checkRuns(block.runs) }
    }
    case 'paragraph':
      return { type: 'paragraph', runs: checkRuns(shape(value, ['type', 'runs']).runs) }
    case 'blockquote': {
      const block = shape(value, ['type', 'paragraphs'])
      return { type: 'blockquote', paragraphs: array(block.paragraphs, PARAGRAPHS_MAX, 'paragraphs').map(checkRuns) }
    }
    case 'list':
      return checkList(value, 1)
    case 'table': {
      const block = shape(value, ['type', 'head', 'body'])
      return { type: 'table', head: checkRows(block.head, 'header rows'), body: checkRows(block.body, 'rows') }
    }
    case 'code': {
      const block = shape(value, ['type', 'text'], ['lang'])
      const text = string(block.text, CODE_TEXT_MAX, 'code', true)
      if (block.lang === undefined) return { type: 'code', text }
      if (!isRunLang(block.lang)) throw invalid('unknown code language')
      return { type: 'code', text, lang: block.lang }
    }
    case 'image':
      return checkImage(value)
    default:
      throw invalid(`unknown block type "${String(value.type)}"`)
  }
}

export const cleanAlt = (text: string): string => cleanText(text).replace(/\s+/g, ' ').trim()

const runsText = (runs: readonly Run[]) => runs.reduce((n, r) => n + ('text' in r ? r.text.length : 0), 0)

function checkImage(value: Record<string, unknown>): ImageBlock {
  const block = shape(value, ['type', 'image', 'alt'], ['caption'])
  const n = block.image
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > MAX_BOOK_IMAGES)
    throw invalid(`image must be a picture number from 0 to ${MAX_BOOK_IMAGES}`)
  if (typeof block.alt !== 'string') throw invalid('alt must be text')
  const alt = cleanAlt(block.alt)
  if (alt.length > ALT_MAX) throw new UploadError('too-long', `alt: longer than ${ALT_MAX} characters`)
  const caption = block.caption === undefined ? [] : checkRuns(block.caption)
  if (runsText(caption) > CAPTION_MAX)
    throw new UploadError('too-long', `caption: longer than ${CAPTION_MAX} characters`)
  const shown = caption.some((r) => 'text' in r && r.text.trim())
  if (n === 0 && !shown) throw invalid('a figure without a picture needs a caption')
  return shown ? { type: 'image', image: n, alt, caption } : { type: 'image', image: n, alt }
}

export function checkChapterUpload(value: unknown): DraftChapter {
  const chapter = shape(value, ['title', 'blocks'])
  const title = string(chapter.title, CHAPTER_TITLE_MAX, 'chapter title').trim()
  if (!title) throw invalid('the chapter needs a title')
  return { title, blocks: array(chapter.blocks, MAX_CHAPTER_BLOCKS, 'blocks').map(checkBlock) }
}

export interface BookUpload extends Omit<BookMetadata, 'cover'> {
  chapterCount: number
  images: { count: number; bytes: number }
}

const isCount = (value: unknown, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max

function checkImages(value: unknown): BookUpload['images'] {
  if (optional(value)) return { count: 0, bytes: 0 }
  const { count, bytes } = shape(value, ['count', 'bytes'])
  if (!isCount(count, MAX_BOOK_IMAGES) || !isCount(bytes, MAX_BOOK_IMAGE_BYTES))
    throw invalid(`images: at most ${MAX_BOOK_IMAGES} pictures and ${MAX_BOOK_IMAGE_BYTES} bytes`)
  if (bytes < count || bytes > count * MAX_IMAGE_BYTES) throw invalid('images: bytes do not fit the count')
  return { count, bytes }
}

const optional = (value: unknown) => value === undefined || value === null

export function checkDetails(book: Record<string, unknown>, now = new Date()): BookDetails {
  let description: string | null = null
  if (!optional(book.description)) {
    if (typeof book.description !== 'string') throw invalid('description must be text')
    description = cleanDescription(book.description, { cap: false })
    if (description && description.length > DESCRIPTION_MAX)
      throw invalid(`description: longer than ${DESCRIPTION_MAX} characters`)
  }
  let isbn: string | null = null
  if (!optional(book.isbn)) {
    if (typeof book.isbn !== 'string') throw invalid('isbn must be text')
    if (book.isbn.trim()) {
      isbn = normalizeIsbn(book.isbn)
      if (!isbn) throw invalid('isbn is not a valid ISBN')
    }
  }
  let publisher: string | null = null
  if (!optional(book.publisher)) {
    if (typeof book.publisher !== 'string') throw invalid('publisher must be text')
    publisher = cleanText(book.publisher).replace(/\s+/g, ' ').trim() || null
    if (publisher && publisher.length > PUBLISHER_MAX)
      throw invalid(`publisher: longer than ${PUBLISHER_MAX} characters`)
  }
  let publishedYear: number | null = null
  if (!optional(book.publishedYear)) {
    const year = book.publishedYear
    if (typeof year !== 'number' || !Number.isInteger(year) || year < 1 || year > now.getUTCFullYear() + 1)
      throw invalid('publishedYear must be a year from 1 to next year')
    publishedYear = year
  }
  return { description, isbn, publisher, publishedYear }
}

export function checkBookUpload(value: unknown, maxChapters: number): BookUpload {
  const book = shape(
    value,
    ['title', 'author', 'language', 'chapterCount'],
    ['description', 'isbn', 'publisher', 'publishedYear', 'images'],
  )
  const title = string(book.title, TITLE_MAX, 'title').trim()
  const author = string(book.author, AUTHOR_MAX, 'author').trim()
  const language = string(book.language, 35, 'language').trim()
  if (!title) throw invalid('the book needs a title')
  if (!author) throw invalid('the book needs an author')
  if (!LANGUAGE_TAG.test(language)) throw invalid('language must be a BCP 47 tag such as "en" or "pt-BR"')
  const count = book.chapterCount
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1)
    throw invalid('chapterCount must be 1 or more')
  if (count > maxChapters) throw new UploadError('too-long', `more than ${maxChapters} chapters`)
  return { title, author, language, details: checkDetails(book), chapterCount: count, images: checkImages(book.images) }
}
