import { READER_SHELF_HUE } from '~/shared/content/hues'
import type { Shelf, ShelfBook } from '~/shared/content/library'
import { matchesQuery } from '~/shared/lib/search'
import type { ShelfView } from '~/shared/shelves/contract'
import { shelfFilter, shelfIdOf } from '~/shared/shelves/shelves'

export type LibraryFilter = string

export function resolveFilter(filter: LibraryFilter, readerShelves: readonly ShelfView[]): LibraryFilter {
  const id = filter.startsWith('shelf-') ? shelfIdOf(filter) : undefined
  if (id === undefined) return filter
  return id !== null && readerShelves.some((s) => s.id === id) ? filter : 'all'
}

export function shelfRowFor(shelf: ShelfView, allShelves: readonly Shelf[], query: string): Shelf {
  const found = new Map<string, { book: ShelfBook; series: string }>()
  for (const row of allShelves) for (const book of row.books) found.set(book.slug, { book, series: row.title })
  const books = shelf.books.flatMap((slug) => {
    const hit = found.get(slug)
    return hit && matchesQuery(query, [hit.book.title, hit.series]) ? [hit.book] : []
  })
  return {
    slug: shelfFilter(shelf.id),
    title: shelf.name,
    description: '',
    collectionSlug: shelfFilter(shelf.id),
    kind: 'chapter',
    tone: 'default',
    hue: READER_SHELF_HUE,
    hasAudio: books.some((b) => b.hasAudio),
    books,
  }
}

export function filterShelves(
  shelves: readonly Shelf[],
  query: string,
  filter: LibraryFilter,
  readerShelves: readonly ShelfView[] = [],
): Shelf[] {
  const id = shelfIdOf(filter)
  const reader = id === null ? undefined : readerShelves.find((s) => s.id === id)
  if (reader) {
    const row = shelfRowFor(reader, shelves, query)
    return row.books.length > 0 || query.trim() === '' ? [row] : []
  }
  return shelves.flatMap((shelf) => {
    if (filter !== 'all' && filter !== 'audio' && shelf.collectionSlug !== filter) return []
    const seriesMatches = query.trim() !== '' && matchesQuery(query, [shelf.title])
    const books = shelf.books.filter(
      (book) => (filter !== 'audio' || book.hasAudio) && (seriesMatches || matchesQuery(query, [book.title])),
    )
    return books.length > 0 ? [{ ...shelf, books }] : []
  })
}

export function countBooks(shelves: readonly Shelf[]): number {
  return shelves.reduce((n, s) => n + s.books.length, 0)
}
