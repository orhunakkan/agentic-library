import '@tanstack/react-start/server-only'
import { notFound } from '@tanstack/react-router'
import { getRequest } from '@tanstack/react-start/server'
import { type BookSearchHit, IN_BOOK_HIT_LIMIT, searchBook } from '~/shared/content/book-search'
import { parseBookSlug, privateBookSlug } from '~/shared/content/book-slug'
import {
  coverUrlOf,
  type PrivateCoverMeta,
  partialChapterBook,
  privateBookHref,
  privateCover,
  privateCoverImage,
  privateReaderContext,
} from '~/shared/content/private-book'
import { buildReaderView, type ReaderContext, type ReaderView } from '~/shared/content/reader-view'
import type { CoverStyle } from '~/shared/content/schema'
import { MAX_CHAPTERS } from '~/shared/import/limits'
import { chapterBookChapter, type SpeechBook, type SpeechChapterData } from '~/shared/read-aloud/speech-text'
import { sessionForRequest } from './auth.ts'
import { getDb, isDatabaseConfigured } from './db.ts'
import { privateVersion } from './downloads/version.ts'
import { loadBookText, loadReaderBook, loadSpeechChapter, toChapterBook } from './user-books.ts'

const MAX_PAGE = 100_000

export async function owned(
  slug: string,
  request: Request = getRequest(),
): Promise<{ bookId: string; userId: number; username: string }> {
  const parsed = parseBookSlug(slug)
  if (parsed?.kind !== 'private' || !isDatabaseConfigured()) throw notFound()
  const bookId = parsed.id
  const session = await sessionForRequest(request)
  if (!session) throw notFound()
  return { bookId, userId: session.userId, username: session.username }
}

export interface PrivateDetails {
  title: string
  author: string
  language: string
  description: string | null
  cover: PrivateCoverMeta | null
}

export function privateContext(bookId: string, book: PrivateDetails, chapterCount: number): ReaderContext {
  return privateReaderContext({
    id: bookId,
    title: book.title,
    author: book.author,
    language: book.language,
    chapterCount,
    description: book.description,
    cover: book.cover,
  })
}

export function privateSpeechBook(
  bookId: string,
  book: Omit<PrivateDetails, 'description'>,
  chapterTitles: string[],
): SpeechBook {
  const image = privateCoverImage(bookId, book.cover)
  return {
    slug: privateBookSlug(bookId),
    title: book.title,
    author: book.author,
    href: privateBookHref(bookId),
    coverUrl: coverUrlOf(image, book.title, book.author),
    cover: privateCover(book.title),
    image,
    language: book.language,
    chapterTitles,
  }
}

export async function privateReaderPage(
  slug: string,
  part: string,
  n: string | undefined,
): Promise<{ view: ReaderView; cover: CoverStyle; audio: null; offlineVersion: string }> {
  const { bookId, userId } = await owned(slug)
  if (n !== undefined && (!/^[1-9]\d{0,5}$/.test(n) || n === '1' || Number(n) > MAX_PAGE)) throw notFound()
  const pageIndex = n === undefined ? 0 : Number(n) - 1
  const book = await loadReaderBook(getDb(), userId, bookId, part, pageIndex)
  if (!book || book.html === null) throw notFound()
  const context = privateContext(bookId, book, book.chapters.length)
  const content = partialChapterBook(slug, book.chapters, { chapterSlug: part, index: pageIndex, html: book.html })
  const view = buildReaderView(context, content, part, n)
  if (!view) throw notFound()
  return { view, cover: context.meta.cover, audio: null, offlineVersion: privateVersion(context, book.chapters) }
}

export async function privateSpeechChapter(slug: string, chapterIndex: number): Promise<SpeechChapterData> {
  const { bookId, userId } = await owned(slug)
  if (!Number.isInteger(chapterIndex) || chapterIndex < 0 || chapterIndex >= MAX_CHAPTERS) throw notFound()
  const book = await loadSpeechChapter(getDb(), userId, bookId, chapterIndex)
  if (!book) throw notFound()
  return {
    book: privateSpeechBook(bookId, book, book.chapterTitles),
    chapter: chapterBookChapter(slug, book.chapter, chapterIndex, book.chapterCount),
  }
}

export async function privateBookSearch(slug: string, query: string): Promise<BookSearchHit[]> {
  const { bookId, userId } = await owned(slug)
  const chapters = await loadBookText(getDb(), userId, bookId)
  if (!chapters) throw notFound()
  return searchBook(toChapterBook(slug, chapters), query, { limit: IN_BOOK_HIT_LIMIT })
}
