import '@tanstack/react-start/server-only'
import type { BookPage as BookPageView } from '~/shared/content/book-page'
import { type BookSearchHit, IN_BOOK_HIT_LIMIT, searchBook } from '~/shared/content/book-search'
import { bookHref } from '~/shared/content/library'
import { privateBookHref } from '~/shared/content/private-book'
import type { ReaderView } from '~/shared/content/reader-view'
import type { AudioBook, BookContent, CoverStyle } from '~/shared/content/schema'
import type { BookPage } from '~/shared/highlights/page-text'
import { MAX_CHAPTERS } from '~/shared/import/limits'
import type { OfflineBook } from '~/shared/offline/book'
import type { SpeechChapterData } from '~/shared/read-aloud/speech-text'
import { isBookSlug } from '../../shared/content/book-slug.ts'
import { audiobookAudio } from '../audiobooks/view.ts'
import type { Db } from '../db.ts'
import { catalogueBook, catalogueBooks, loadBook } from '../repository.ts'
import { openCatalogueBook } from './catalogue.ts'
import { openPrivateText } from './private.ts'
import { type BookRef, refFor, slugOf } from './ref.ts'

/** What every opened book carries, whether it is read or listened to. */
export interface OpenedBook {
  slug: string
  ref: BookRef
  title: string
  author: string
  language: string
  href: string
  /** The book's audiobook, or null when it has none. */
  audio(): Promise<AudioBook | null>
}

/** A book with text to read. A private book's text is loaded only when a method asks for it. */
export interface TextBook extends OpenedBook {
  format: 'text'
  content(): Promise<BookContent>
  pages(): Promise<readonly BookPage[]>
  /** One page of a chapter in the reader (`n` is the page number, absent for page one); null when there is no such page. */
  readerPage(part: string, n: string | undefined): Promise<ReaderPage | null>
  /** One chapter to read aloud, with the book as the dock shows it; null past the last chapter. */
  speechChapter(index: number): Promise<SpeechChapterData | null>
  search(query: string): Promise<BookSearchHit[]>
  /** The whole book to keep offline; null when it is gone. */
  offlineCopy(): Promise<OfflineBook | null>
}

/** A text book as each kind builds it; what every text book does alike is added by `openBook`. */
export type BuiltTextBook = Omit<TextBook, 'search'>

export interface ReaderPage {
  view: ReaderView
  cover: CoverStyle
  audio: BookPageView['audio']
  offlineVersion: string
}

/** A private audiobook: recorded audio with no text. */
export interface RecordedBook extends OpenedBook {
  format: 'audio'
}

export type Book = TextBook | RecordedBook

interface PrivateRow {
  title: string
  author: string
  language: string
  format: 'audio' | null
}

const isChapterIndex = (index: number) => Number.isInteger(index) && index >= 0 && index < MAX_CHAPTERS

/** What every text book does alike: refuse a chapter index no book could hold before loading anything, and search its text. */
function asTextBook(book: BuiltTextBook): TextBook {
  const { speechChapter } = book
  return {
    ...book,
    speechChapter: async (index) => (isChapterIndex(index) ? speechChapter(index) : null),
    search: async (query) => searchBook(await book.content(), query, { limit: IN_BOOK_HIT_LIMIT }),
  }
}

/** Opens a book by its book slug. `userId` is null when signed out, and `db` is null when there is no database: then only catalogue books open. Null means no such book, not ready, or not yours. */
export async function openBook(db: Db | null, userId: number | null, slug: string): Promise<Book | null> {
  if (!isBookSlug(slug)) return null
  const ref = refFor(slug)
  if (ref.userBookId === null) {
    const [meta, content] = await Promise.all([catalogueBook(slug), loadBook(slug)])
    return meta && content ? asTextBook(openCatalogueBook(meta, content)) : null
  }
  if (db === null || userId === null) return null
  const bookId = ref.userBookId
  const [row] = await db<PrivateRow[]>`
    select title, author, language, format from user_books
    where id = ${bookId} and user_id = ${userId} and status = 'ready'`
  if (!row) return null
  const opened: OpenedBook = {
    slug,
    ref,
    title: row.title,
    author: row.author,
    language: row.language,
    href: privateBookHref(bookId),
    audio: () => audiobookAudio(db, userId, bookId),
  }
  return row.format === 'audio'
    ? { ...opened, format: 'audio' }
    : asTextBook(openPrivateText(db, userId, bookId, opened))
}

export interface BookLabel {
  title: string
  author: string
  href: string | null
  removed: boolean
}

const GONE: BookLabel = { title: 'A book no longer in the library', author: '', href: null, removed: true }

export async function labelsFor(db: Db, userId: number, refs: readonly BookRef[]): Promise<Map<string, BookLabel>> {
  const labels = new Map<string, BookLabel>()
  const ids = [...new Set(refs.flatMap((r) => (r.userBookId === null ? [] : [r.userBookId])))]
  const [catalogue, rows] = await Promise.all([
    refs.some((r) => r.slug !== null) ? catalogueBooks() : null,
    ids.length
      ? db<{ id: string; title: string; author: string }[]>`
          select id, title, author from user_books
          where id = any(${ids}::uuid[]) and user_id = ${userId} and status = 'ready'`
      : [],
  ])
  for (const ref of refs) {
    if (ref.slug === null) continue
    const meta = catalogue?.get(ref.slug)
    labels.set(ref.slug, meta ? { title: meta.title, author: meta.author, href: bookHref(meta), removed: false } : GONE)
  }
  for (const row of rows) {
    labels.set(slugOf({ slug: null, userBookId: row.id }), {
      title: row.title,
      author: row.author,
      href: privateBookHref(row.id),
      removed: false,
    })
  }
  return labels
}

export const onBook = (db: Db, ref: BookRef) =>
  ref.userBookId === null ? db`book_slug = ${ref.slug}` : db`user_book_id = ${ref.userBookId}`

export const ownedBook = (db: Db, userId: number, ref: BookRef) =>
  ref.userBookId === null
    ? db`true`
    : db`exists (select 1 from user_books where id = ${ref.userBookId} and user_id = ${userId} and status = 'ready')`

const ALIAS = /^[a-z_]+$/

export function onReadableBook(db: Db, userId: number, alias: string) {
  if (!ALIAS.test(alias)) throw new Error('not a table alias')
  const column = db.unsafe(`${alias}.user_book_id`)
  return db`(${column} is null or exists (
    select 1 from user_books where id = ${column} and user_id = ${userId} and status = 'ready'))`
}

export async function ownsBook(db: Db, userId: number, ref: BookRef): Promise<boolean> {
  if (ref.userBookId === null) return true
  const [row] = await db<{ owned: boolean }[]>`select ${ownedBook(db, userId, ref)} as owned`
  return row?.owned === true
}
