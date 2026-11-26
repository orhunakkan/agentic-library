import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { buildBookPage } from '~/shared/content/book-page'
import { isPrivateBookSlug } from '~/shared/content/book-slug'
import { collectionHues } from '~/shared/content/hues'
import { bookHref, buildLibrary, seriesBooks, toShelfBook } from '~/shared/content/library'
import { chapterPageHref, pagedHref } from '~/shared/content/navigation'
import { catalogWithoutRemoved, removedShelfBooks, withoutRemoved } from '~/shared/content/removed'
import type { SpeechChapterData } from '~/shared/read-aloud/speech-text'
import { readerOf } from './auth'
import { openTextBook, type ReaderPage, type TextBook } from './books/book'
import { getConfig, type SiteContact } from './config'
import { ratingState } from './ratings/actions'
import { loadSpeechChapterData, speechInput } from './read-aloud'
import { libraryExclusionsFor } from './removed-books/actions'
import { loadAudio, loadBook, loadCatalog } from './repository'

const str = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) throw new Error(`Invalid ${name}`)
  return value
}

/** Opens a text book for whoever is signed in on this request; any other answer is a 404. */
async function readerTextBook(slug: string): Promise<TextBook> {
  const { db, userId } = await readerOf(getRequest())
  const book = await openTextBook(db, userId, slug)
  if (!book) throw notFound()
  return book
}

export const getNavData = createServerFn({ method: 'GET' }).handler(async () => {
  const [full, removed] = await Promise.all([loadCatalog(), libraryExclusionsFor(getRequest())])
  const catalog = catalogWithoutRemoved(full, removed)
  const library = withoutRemoved(buildLibrary(full), removed)
  const paged = library.collections.find((c) => c.kind === 'paged')
  const pagedShelf = library.shelves.find((s) => s.collectionSlug === paged?.slug)
  return {
    stats: library.stats,
    collections: library.collections.map((collection) => ({
      slug: collection.slug,
      title: collection.title,
      kind: collection.kind,
      hue: collection.hue,
      bookCount: collection.bookCount,
      subtitle:
        collection.kind === 'paged'
          ? `${collection.bookCount} books · page-by-page reading`
          : `${collection.seriesCount} series · ${collection.bookCount} books`,
      href:
        collection.kind === 'paged' && pagedShelf
          ? `/library/${pagedShelf.slug}`
          : `/library?filter=${collection.slug}`,
    })),
    featured: catalog.series
      .filter((s) => s.featuredLabel)
      .slice(0, 5)
      .map((s) => ({
        slug: s.slug,
        title: s.title,
        subtitle: `${catalog.books.filter((b) => b.seriesSlug === s.slug).length} vol. · ${s.featuredLabel}`,
      })),
  }
})

export const getLibrary = createServerFn({ method: 'GET' }).handler(async () => {
  const [catalog, removed] = await Promise.all([loadCatalog(), libraryExclusionsFor(getRequest())])
  return { ...withoutRemoved(buildLibrary(catalog), removed), removed: removedShelfBooks(catalog, removed) }
})

export const getSeriesPage = createServerFn({ method: 'GET' })
  .validator((data: { series: string }) => ({ series: str(data.series, 'series') }))
  .handler(async ({ data }) => {
    const [catalog, removed] = await Promise.all([loadCatalog(), libraryExclusionsFor(getRequest())])
    const series = catalog.series.find((s) => s.slug === data.series)
    if (!series) throw notFound()
    const collection = catalog.collections.find((c) => c.slug === series.collectionSlug)
    const all = seriesBooks(catalog, series.slug)
    const books = all.filter((b) => !removed.has(b.slug)).map(toShelfBook)
    const hue = (collection && collectionHues(catalog.collections).get(collection.slug)) ?? 'violet'
    return {
      series,
      kind: collection?.kind ?? 'chapter',
      collection: collection?.title ?? '',
      hue,
      books,
      removedCount: all.length - books.length,
    }
  })

export const getBookPage = createServerFn({ method: 'GET' })
  .validator((data: { series: string; book: string }) => ({
    series: str(data.series, 'series'),
    book: str(data.book, 'book'),
  }))
  .handler(async ({ data }) => {
    if (isPrivateBookSlug(data.book)) throw notFound()
    const [catalog, content, audio, removed, rating] = await Promise.all([
      loadCatalog(),
      loadBook(data.book),
      loadAudio(data.book),
      libraryExclusionsFor(getRequest()),
      ratingState(getRequest(), data.book),
    ])
    const page = content ? buildBookPage(catalog, content, audio, data.series, data.book) : null
    if (!page) throw notFound()
    return { ...page, removed: removed.has(data.book), rating }
  })

export const getReaderPage = createServerFn({ method: 'GET' })
  .validator((data: { book: string; part: string; n?: string }) => ({
    book: str(data.book, 'book'),
    part: str(data.part, 'part'),
    n: data.n === undefined ? undefined : str(data.n, 'n'),
  }))
  .handler(async ({ data }): Promise<ReaderPage> => {
    const book = await readerTextBook(data.book)
    const page = await book.readerPage(data.part, data.n)
    if (!page) throw notFound()
    return page
  })

export const searchInBook = createServerFn({ method: 'GET' })
  .validator((data: { book: string; q: string }) => ({
    book: str(data.book, 'book'),
    q: String(data.q ?? '').slice(0, 120),
  }))
  .handler(async ({ data }) => (await readerTextBook(data.book)).search(data.q))

export const getSpeechChapter = createServerFn({ method: 'GET' })
  .validator((data: { book: string; chapter: number }) => speechInput(data))
  .handler(({ data }): Promise<SpeechChapterData> => loadSpeechChapterData(data.book, data.chapter))

export const getSearchIndex = createServerFn({ method: 'GET' }).handler(async () => {
  const [full, removed] = await Promise.all([loadCatalog(), libraryExclusionsFor(getRequest())])
  const catalog = catalogWithoutRemoved(full, removed)
  const entries: { kind: 'book' | 'series' | 'chapter'; title: string; context: string; href: string }[] = []
  for (const series of catalog.series) {
    const count = catalog.books.filter((b) => b.seriesSlug === series.slug).length
    entries.push({
      kind: 'series',
      title: series.title,
      context: `${count} ${count === 1 ? 'book' : 'books'}`,
      href: `/library/${series.slug}`,
    })
  }
  for (const book of catalog.books) {
    entries.push({ kind: 'book', title: book.title, context: book.author, href: bookHref(book) })
    const content = await loadBook(book.slug)
    if (!content) continue
    if (content.kind === 'paged') {
      for (const chapter of content.chapters)
        entries.push({
          kind: 'chapter',
          title: chapter.title,
          context: book.title,
          href: pagedHref(book.slug, chapter.startPage),
        })
    } else {
      for (const chapter of content.chapters)
        entries.push({
          kind: 'chapter',
          title: chapter.title,
          context: book.title,
          href: chapterPageHref(book.slug, chapter.slug, 1),
        })
    }
  }
  return entries
})

export const getSiteContact = createServerFn({ method: 'GET' }).handler(
  (): SiteContact | null => getConfig().siteContact,
)
