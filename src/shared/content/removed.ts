import { type Library, type ShelfBook, toShelfBook } from './library'
import type { Catalog } from './schema'

export function withoutRemoved(library: Library, removed: ReadonlySet<string>): Library {
  if (removed.size === 0) return library
  const shelves = library.shelves.flatMap((shelf) => {
    const books = shelf.books.filter((b) => !removed.has(b.slug))
    if (books.length === shelf.books.length) return [shelf]
    return books.length > 0 ? [{ ...shelf, books, hasAudio: books.some((b) => b.hasAudio) }] : []
  })
  const collections = library.collections.flatMap((c) => {
    const own = shelves.filter((s) => s.collectionSlug === c.slug)
    const bookCount = own.reduce((n, s) => n + s.books.length, 0)
    return bookCount > 0 ? [{ ...c, bookCount, seriesCount: own.length }] : []
  })
  const books = shelves.flatMap((s) => s.books)
  return {
    shelves,
    collections,
    stats: { books: books.length, series: shelves.length, audiobooks: books.filter((b) => b.hasAudio).length },
  }
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

export function removedShelfBooks(catalog: Catalog, removed: ReadonlySet<string>): ShelfBook[] {
  return catalog.books
    .filter((b) => removed.has(b.slug))
    .map(toShelfBook)
    .sort((a, b) => collator.compare(a.title, b.title))
}

export function catalogWithoutRemoved(catalog: Catalog, removed: ReadonlySet<string>): Catalog {
  if (removed.size === 0) return catalog
  const books = catalog.books.filter((b) => !removed.has(b.slug))
  const emptied = new Set(catalog.books.filter((b) => removed.has(b.slug)).map((b) => b.seriesSlug))
  for (const b of books) emptied.delete(b.seriesSlug)
  return { ...catalog, books, series: catalog.series.filter((s) => !emptied.has(s.slug)) }
}
