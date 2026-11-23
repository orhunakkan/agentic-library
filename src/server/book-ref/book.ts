import '@tanstack/react-start/server-only'
import { bookHref } from '~/shared/content/library'
import { privateBookHref } from '~/shared/content/private-book'
import type { AudioBook, BookContent, BookMeta } from '~/shared/content/schema'
import { type BookPage, bookPages } from '~/shared/highlights/page-text'
import { MAX_CHAPTERS } from '~/shared/import/limits'
import { chapterBookChapter, type SpeechChapter, speechChapter } from '~/shared/read-aloud/speech-text'
import { isBookSlug } from '../../shared/content/book-slug.ts'
import { audiobookAudio } from '../audiobooks/view.ts'
import type { Db } from '../db.ts'
import { catalogueBook, catalogueBooks, loadAudio, loadBook } from '../repository.ts'
import { loadBookText, loadSpeechChapter, toChapterBook } from '../user-books.ts'
import { type BookRef, refFor, slugOf } from './ref.ts'

export interface FoundBook {
  slug: string
  ref: BookRef
  title: string
  author: string
  language: string
  href: string
  format: 'text' | 'audio'
}

export interface TextBook extends FoundBook {
  format: 'text'
  content(): Promise<BookContent>
  pages(): Promise<readonly BookPage[]>
  chapter(index: number): Promise<SpeechChapter | null>
}

const cataloguePages = new WeakMap<BookContent, readonly BookPage[]>()

function sharedPages(content: BookContent): readonly BookPage[] {
  let pages = cataloguePages.get(content)
  if (!pages) {
    pages = bookPages(content)
    cataloguePages.set(content, pages)
  }
  return pages
}

function catalogueFound(meta: BookMeta): FoundBook {
  return {
    slug: meta.slug,
    ref: { slug: meta.slug, userBookId: null },
    title: meta.title,
    author: meta.author,
    language: meta.language,
    href: bookHref(meta),
    format: 'text',
  }
}

function catalogueText(meta: BookMeta, content: BookContent): TextBook {
  return {
    ...catalogueFound(meta),
    format: 'text',
    content: async () => content,
    pages: async () => sharedPages(content),
    chapter: async (index) => speechChapter(content, index),
  }
}

interface PrivateRow {
  title: string
  author: string
  language: string
  format: 'audio' | null
}

function privateText(db: Db, userId: number, bookId: string, found: FoundBook): TextBook {
  let content: Promise<BookContent> | undefined
  let pages: Promise<readonly BookPage[]> | undefined
  const loadContent = () => {
    content ??= loadBookText(db, userId, bookId).then((chapters) => toChapterBook(found.slug, chapters ?? []))
    return content
  }
  return {
    ...found,
    format: 'text',
    content: loadContent,
    pages: () => {
      pages ??= loadContent().then(bookPages)
      return pages
    },
    chapter: async (index) => {
      if (!Number.isInteger(index) || index < 0 || index >= MAX_CHAPTERS) return null
      const loaded = await loadSpeechChapter(db, userId, bookId, index)
      return loaded && chapterBookChapter(found.slug, loaded.chapter, index, loaded.chapterCount)
    },
  }
}

export function findBook(db: Db, userId: number, slug: string, needs: 'text'): Promise<TextBook | null>
export function findBook(db: Db, userId: number, slug: string, needs?: 'text' | 'any'): Promise<FoundBook | null>
export async function findBook(
  db: Db,
  userId: number,
  slug: string,
  needs: 'text' | 'any' = 'any',
): Promise<FoundBook | null> {
  if (!isBookSlug(slug)) return null
  const ref = refFor(slug)
  if (ref.userBookId === null) {
    const meta = await catalogueBook(slug)
    if (!meta) return null
    if (needs === 'any') return catalogueFound(meta)
    const content = await loadBook(slug)
    return content && catalogueText(meta, content)
  }
  const [row] = await db<PrivateRow[]>`
    select title, author, language, format from user_books
    where id = ${ref.userBookId} and user_id = ${userId} and status = 'ready'`
  if (!row) return null
  const found: FoundBook = {
    slug,
    ref,
    title: row.title,
    author: row.author,
    language: row.language,
    href: privateBookHref(ref.userBookId),
    format: row.format === 'audio' ? 'audio' : 'text',
  }
  if (needs === 'any') return found
  return found.format === 'text' ? privateText(db, userId, ref.userBookId, found) : null
}

export function findAudio(db: Db, userId: number, slug: string): Promise<AudioBook | null> {
  if (!isBookSlug(slug)) return Promise.resolve(null)
  const ref = refFor(slug)
  return ref.userBookId === null ? loadAudio(slug) : audiobookAudio(db, userId, ref.userBookId)
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
