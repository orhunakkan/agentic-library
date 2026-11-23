import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import type { BillingOffer } from '~/shared/billing/billing'
import { buildBookPage } from '~/shared/content/book-page'
import { IN_BOOK_HIT_LIMIT, searchBook } from '~/shared/content/book-search'
import { isPrivateBookSlug } from '~/shared/content/book-slug'
import { collectionHues } from '~/shared/content/hues'
import { bookHref, buildLibrary, seriesBooks, toShelfBook } from '~/shared/content/library'
import { chapterPageHref, pagedHref } from '~/shared/content/navigation'
import { buildReaderView } from '~/shared/content/reader-view'
import { catalogWithoutRemoved, removedShelfBooks, withoutRemoved } from '~/shared/content/removed'
import type { SpeechChapterData } from '~/shared/read-aloud/speech-text'
import { billingOffer } from './billing/actions'
import { getConfig, type SiteContact } from './config'
import { catalogueVersion } from './downloads/version'
import { privateBookSearch, privateReaderPage } from './private-reading'
import { ratingState } from './ratings/actions'
import { loadSpeechChapterData, speechInput } from './read-aloud'
import { libraryExclusionsFor } from './removed-books/actions'
import { catalogueBook, loadAudio, loadBook, loadCatalog } from './repository'

const str = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) throw new Error(`Invalid ${name}`)
  return value
}

export const getNavData = createServerFn({ method: 'GET' }).handler(async () => {
  const [full, removed] = await Promise.all([loadCatalog(), libraryExclusionsFor(getRequest())])
  const catalog = catalogWithoutRemoved(full, removed)
  const library = withoutRemoved(buildLibrary(full), removed)
  const paged = library.collections.find((c) => c.kind === 'paged')
  const pagedShelf = library.shelves.find((s) => s.collectionSlug === paged?.slug)
  return {
    stats: library.stats,
    collections: library.collections.map((c) => ({
      slug: c.slug,
      title: c.title,
      kind: c.kind,
      hue: c.hue,
      bookCount: c.bookCount,
      subtitle:
        c.kind === 'paged'
          ? `${c.bookCount} books · page-by-page reading`
          : `${c.seriesCount} series · ${c.bookCount} books`,
      href: c.kind === 'paged' && pagedShelf ? `/library/${pagedShelf.slug}` : `/library?filter=${c.slug}`,
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
  .handler(async ({ data }) => {
    if (isPrivateBookSlug(data.book)) return privateReaderPage(data.book, data.part, data.n)
    const [catalog, meta, content, audio] = await Promise.all([
      loadCatalog(),
      catalogueBook(data.book),
      loadBook(data.book),
      loadAudio(data.book),
    ])
    const view = meta && content ? buildReaderView({ meta, catalog }, content, data.part, data.n) : null
    if (!meta || !content || !view) throw notFound()
    const page = buildBookPage(catalog, content, audio, meta.seriesSlug, meta.slug)
    const offlineVersion = (await catalogueVersion(meta.slug)) ?? ''
    return { view, cover: meta.cover, audio: page?.audio ?? null, offlineVersion }
  })

export const searchInBook = createServerFn({ method: 'GET' })
  .validator((data: { book: string; q: string }) => ({
    book: str(data.book, 'book'),
    q: String(data.q ?? '').slice(0, 120),
  }))
  .handler(async ({ data }) => {
    if (isPrivateBookSlug(data.book)) return privateBookSearch(data.book, data.q)
    const content = await loadBook(data.book)
    if (!content) throw notFound()
    return searchBook(content, data.q, { limit: IN_BOOK_HIT_LIMIT })
  })

export const getSpeechChapter = createServerFn({ method: 'GET' })
  .validator((data: { book: string; chapter: number }) => speechInput(data))
  .handler(({ data }): Promise<SpeechChapterData> => loadSpeechChapterData(data.book, data.chapter))

export const getSearchIndex = createServerFn({ method: 'GET' }).handler(async () => {
  const [full, removed] = await Promise.all([loadCatalog(), libraryExclusionsFor(getRequest())])
  const catalog = catalogWithoutRemoved(full, removed)
  const entries: { kind: 'book' | 'series' | 'chapter'; title: string; context: string; href: string }[] = []
  for (const s of catalog.series) {
    const count = catalog.books.filter((b) => b.seriesSlug === s.slug).length
    entries.push({
      kind: 'series',
      title: s.title,
      context: `${count} ${count === 1 ? 'book' : 'books'}`,
      href: `/library/${s.slug}`,
    })
  }
  for (const b of catalog.books) {
    entries.push({ kind: 'book', title: b.title, context: b.author, href: bookHref(b) })
    const content = await loadBook(b.slug)
    if (!content) continue
    if (content.kind === 'paged') {
      for (const c of content.chapters)
        entries.push({ kind: 'chapter', title: c.title, context: b.title, href: pagedHref(b.slug, c.startPage) })
    } else {
      for (const c of content.chapters)
        entries.push({ kind: 'chapter', title: c.title, context: b.title, href: chapterPageHref(b.slug, c.slug, 1) })
    }
  }
  return entries
})

export const getBillingOffer = createServerFn({ method: 'GET' }).handler((): Promise<BillingOffer> => billingOffer())

export const getSiteContact = createServerFn({ method: 'GET' }).handler(
  (): SiteContact | null => getConfig().siteContact,
)
