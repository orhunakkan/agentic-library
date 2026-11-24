import '@tanstack/react-start/server-only'
import { partialChapterBook } from '~/shared/content/private-book'
import { buildReaderView } from '~/shared/content/reader-view'
import type { BookContent } from '~/shared/content/schema'
import { type BookPage, bookPages } from '~/shared/highlights/page-text'
import { chapterBookChapter } from '~/shared/read-aloud/speech-text'
import type { Db } from '../db.ts'
import { privateVersion } from '../downloads/version.ts'
import { loadBookText, loadReaderBook, loadSpeechChapter, toChapterBook } from '../user-books.ts'
import type { BuiltTextBook, OpenedBook } from './book.ts'
import { privateOfflineBook } from './offline.ts'
import { privateContext, privateSpeechBook } from './views.ts'

/** The highest page number a reader link may name. */
const MAX_PAGE = 100_000

/** A private text book its owner opened; each method reads only what it needs, and the whole text at most once. */
export function openPrivateText(db: Db, userId: number, bookId: string, opened: OpenedBook): BuiltTextBook {
  let content: Promise<BookContent> | undefined
  let pages: Promise<readonly BookPage[]> | undefined
  const loadContent = () => {
    content ??= loadBookText(db, userId, bookId).then((chapters) => toChapterBook(opened.slug, chapters ?? []))
    return content
  }
  return {
    ...opened,
    format: 'text',
    content: loadContent,
    pages: () => {
      pages ??= loadContent().then(bookPages)
      return pages
    },
    readerPage: async (part, n) => {
      if (n !== undefined && (!/^[1-9]\d{0,5}$/.test(n) || n === '1' || Number(n) > MAX_PAGE)) return null
      const pageIndex = n === undefined ? 0 : Number(n) - 1
      const book = await loadReaderBook(db, userId, bookId, part, pageIndex)
      if (!book || book.html === null) return null
      const context = privateContext(bookId, book, book.chapters.length)
      const partial = partialChapterBook(opened.slug, book.chapters, {
        chapterSlug: part,
        index: pageIndex,
        html: book.html,
      })
      const view = buildReaderView(context, partial, part, n)
      return (
        view && { view, cover: context.meta.cover, audio: null, offlineVersion: privateVersion(context, book.chapters) }
      )
    },
    offlineCopy: () => privateOfflineBook(db, userId, bookId),
    speechChapter: async (index) => {
      const loaded = await loadSpeechChapter(db, userId, bookId, index)
      return (
        loaded && {
          book: privateSpeechBook(bookId, loaded, loaded.chapterTitles),
          chapter: chapterBookChapter(opened.slug, loaded.chapter, index, loaded.chapterCount),
        }
      )
    },
  }
}
