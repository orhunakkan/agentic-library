import '@tanstack/react-start/server-only'
import type { Fragment } from 'postgres'
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
import { isBookSlug, privateBookSlug } from '../../shared/content/book-slug.ts'
import { audiobookAudio } from '../audiobooks/view.ts'
import type { Db, Pool } from '../db.ts'
import { catalogueBook, catalogueBooks, loadBook } from '../repository.ts'
import { openCatalogueBook } from './catalogue.ts'
import { openPrivateText } from './private.ts'
import { type BookRef, refFor } from './ref.ts'

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

/** Opens a book with text to read, as `openBook` does; a recorded audiobook is null like a missing book. */
export async function openTextBook(db: Db | null, userId: number | null, slug: string): Promise<TextBook | null> {
  const book = await openBook(db, userId, slug)
  return book?.format === 'text' ? book : null
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
    labels.set(privateBookSlug(row.id), {
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

/**
 * The `on conflict` target for a row kept once per reader and book, for either kind of book. It names the partial
 * unique index on `(user_id, book_slug, …keys)` or `(user_id, user_book_id, …keys)`; `where` adds the rest of that
 * index's predicate, such as `kind = 'episode'`.
 */
export function onBookConflict(
  db: Db,
  ref: BookRef,
  { keys = [], where }: { keys?: readonly string[]; where?: Fragment } = {},
) {
  const column = db(ref.userBookId === null ? 'book_slug' : 'user_book_id')
  const columns = keys.length ? db`, ${db(keys)}` : db``
  return db`(user_id, ${column}${columns}) where ${column} is not null${where ? db` and ${where}` : db``}`
}

/** The row's id and the book it is in: never set by a caller of `insertCapped`. */
interface KeyColumns {
  id: string
  book_slug: string | null
  user_book_id: string | null
}

/** Where a passage or page was marked, as the migrations anchor it: the page, its offsets and the text either side. */
interface AnchorColumns {
  chapter: string | null
  page: number
  start_offset: number
  end_offset: number
  exact: string
  prefix: string
  suffix: string
}

/**
 * The columns of each table of things a reader keeps many of in a book, with what each holds as the stores read it.
 * `user_id` is left out: `insertCapped` sets it and no store reads it back.
 */
export interface CappedColumns {
  highlights: KeyColumns & AnchorColumns & { color: string; note: string | null; created_at: Date; updated_at: Date }
  bookmarks: KeyColumns & AnchorColumns & { created_at: Date }
  audio_bookmarks: KeyColumns & { [C in keyof AnchorColumns]: AnchorColumns[C] | null } & {
    kind: 'voice' | 'episode'
    episode: string | null
    position_ms: number | null
    created_at: Date
  }
  flashcards: KeyColumns & {
    chapter: string | null
    page: number
    front: string
    back: string
    origin: string
    box: number
    due_at: Date
    reviewed_at: Date | null
    created_at: Date
  }
}

/** The tables of things a reader keeps many of in a book, each capped per book and per reader: by their plan for highlights, by fixed caps for the rest. */
export type CappedTable = keyof CappedColumns

export type CappedColumn<T extends CappedTable> = keyof CappedColumns[T] & string

/** A row of a capped table as read back with only the columns `C`. */
export type CappedRaw<T extends CappedTable, C extends CappedColumn<T>> = Pick<CappedColumns[T], C>

/** The columns a caller sets: not the id, nor the book columns `insertCapped` adds. */
type OwnColumns<T extends CappedTable> = Omit<CappedColumns[T], keyof KeyColumns>

type Value = string | number | Date | null

export interface CappedRow<T extends CappedTable, V extends Partial<OwnColumns<T>>, C extends CappedColumn<T>, Row> {
  table: T
  limits: { perBook: number; perUser: number }
  /** The row's own columns; the reader and book columns are added. A column the table doesn't have is a type error. */
  values: V & Record<Exclude<keyof V, keyof OwnColumns<T>>, never>
  /** The columns to answer with. */
  returning: readonly C[]
  /** The columns of `values` that make two rows the same one: when set, the row already there is answered instead of a second. */
  same?: readonly (keyof V & string)[]
  toRow: (raw: CappedRaw<T, C>) => Row
}

export type Capped<Row> = { row: Row; created: boolean } | 'missing' | 'limit-book' | 'limit-user'

/**
 * Inserts one row about a book, under the reader's lock so parallel inserts can't both take the last slot. It answers
 * `'missing'` when the book is not the reader's, the row already there when `same` matches one, and otherwise checks
 * the per-book cap before the per-reader cap.
 */
export function insertCapped<T extends CappedTable, V extends Partial<OwnColumns<T>>, C extends CappedColumn<T>, Row>(
  pool: Pool,
  userId: number,
  book: BookRef,
  row: CappedRow<T, V, C, Row>,
): Promise<Capped<Row>> {
  return pool.begin(async (tx): Promise<Capped<Row>> => {
    await tx`select id from users where id = ${userId} for update`
    if (!(await ownsBook(tx, userId, book))) return 'missing'
    const name: string = row.table
    const columns: readonly string[] = row.returning
    const table = tx(name)
    const returning = tx(columns)
    const own: Record<string, Value> = row.values
    const same: readonly string[] | undefined = row.same
    const existing = async () => {
      if (!same) return null
      const matches = same.map((column) => {
        const value = own[column] ?? null
        return value === null ? tx`${tx(column)} is null` : tx`${tx(column)} = ${value}`
      })
      const [found] = await tx<CappedRaw<T, C>[]>`
        select ${returning} from ${table}
        where user_id = ${userId} and ${onBook(tx, book)}${matches.map((m) => tx` and ${m}`)}`
      return found ? { row: row.toRow(found), created: false } : null
    }
    const already = await existing()
    if (already) return already
    const [counts] = await tx<{ in_book: string; in_all: string }[]>`
      select count(*) filter (where ${onBook(tx, book)}) as in_book, count(*) as in_all
      from ${table} where user_id = ${userId}`
    if (Number(counts?.in_book ?? 0) >= row.limits.perBook) return 'limit-book'
    if (Number(counts?.in_all ?? 0) >= row.limits.perUser) return 'limit-user'
    const values = { user_id: userId, book_slug: book.slug, user_book_id: book.userBookId, ...own }
    const [created] = await tx<CappedRaw<T, C>[]>`
      insert into ${table} ${tx(values)}
      ${same ? tx`on conflict do nothing` : tx``}
      returning ${returning}`
    if (created) return { row: row.toRow(created), created: true }
    const raced = await existing()
    if (!raced) throw new Error('insert returned no row')
    return raced
  })
}
