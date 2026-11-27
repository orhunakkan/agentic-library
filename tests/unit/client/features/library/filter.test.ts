import { describe, expect, it } from 'vitest'
import { countBooks, filterShelves, resolveFilter, shelfRowFor } from '~/client/features/library/filter'
import { privateBookSlug } from '~/shared/content/book-slug'
import { buildLibrary } from '~/shared/content/library'
import { myShelf } from '~/shared/content/private-book'
import type { ShelfView } from '~/shared/shelves/contract'
import { shelfFilter } from '~/shared/shelves/shelves'
import { fixtureCatalog } from '../../../../fixtures/catalog'

const { shelves } = buildLibrary(fixtureCatalog)
const slugs = (result: ReturnType<typeof filterShelves>) => result.flatMap((s) => s.books.map((b) => b.slug))

describe('filterShelves', () => {
  it('returns everything for an empty query and the "all" filter', () => {
    expect(countBooks(filterShelves(shelves, '', 'all'))).toBe(6)
  })

  it('matches book titles without diacritics', () => {
    expect(slugs(filterShelves(shelves, 'rumi', 'all'))).toEqual(['rumi'])
  })

  it('returns every book of a series whose title matches', () => {
    expect(slugs(filterShelves(shelves, 'emerson', 'all'))).toEqual(['essays', 'representative-men'])
  })

  it('filters by collection', () => {
    expect(slugs(filterShelves(shelves, '', 'inner-path'))).toEqual(['confessions', 'rumi'])
  })

  it('filters audio at book level, not series level', () => {
    expect(slugs(filterShelves(shelves, '', 'audio'))).toEqual(['essays', 'walden'])
  })

  it('combines query and filter with AND', () => {
    expect(slugs(filterShelves(shelves, 'men', 'audio'))).toEqual([])
    expect(slugs(filterShelves(shelves, 'essays', 'audio'))).toEqual(['essays'])
  })

  it('drops shelves left without books', () => {
    expect(filterShelves(shelves, 'walden', 'all').map((s) => s.slug)).toEqual(['walden'])
  })

  it('does not search descriptions or authors', () => {
    expect(countBooks(filterShelves(shelves, 'woods', 'all'))).toBe(0)
  })
})

describe('a reader’s shelf', () => {
  const BOOK_ID = '0b5e0000-0000-4000-8000-000000000001'
  const mine = myShelf([{ id: BOOK_ID, title: 'My notes', author: 'Me', cover: null }])
  const all = [mine, ...shelves]
  const toRead: ShelfView = {
    id: '6f1c0000-0000-4000-8000-000000000000',
    name: 'To read',
    books: [privateBookSlug(BOOK_ID), 'rumi', 'gone-from-the-catalogue', 'essays'],
  }
  const empty: ShelfView = { id: '6f1c0000-0000-4000-8000-000000000001', name: 'Empty', books: [] }
  const readerShelves = [toRead, empty]

  it('gives one row in the shelf’s order, finding a private book through My shelf and skipping unknown slugs', () => {
    const result = filterShelves(all, '', shelfFilter(toRead.id), readerShelves)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ slug: `shelf-${toRead.id}`, title: 'To read', hue: 'violet', hasAudio: true })
    expect(slugs(result)).toEqual([privateBookSlug(BOOK_ID), 'rumi', 'essays'])
  })

  it('keeps a book whose title or whose series’ title matches the query', () => {
    expect(slugs(filterShelves(all, 'rumi', shelfFilter(toRead.id), readerShelves))).toEqual(['rumi'])
    expect(slugs(filterShelves(all, 'emerson', shelfFilter(toRead.id), readerShelves))).toEqual(['essays'])
    expect(slugs(filterShelves(all, 'my shelf', shelfFilter(toRead.id), readerShelves))).toEqual([
      privateBookSlug(BOOK_ID),
    ])
  })

  it('shows an empty shelf’s row with no query, and no row once a query leaves it empty', () => {
    expect(filterShelves(all, '', shelfFilter(empty.id), readerShelves)).toMatchObject([{ title: 'Empty', books: [] }])
    expect(filterShelves(all, 'walden', shelfFilter(toRead.id), readerShelves)).toEqual([])
  })

  it('has no audio tag when none of its books has audio', () => {
    const row = shelfRowFor({ ...toRead, books: ['rumi'] }, all, '')
    expect(row.hasAudio).toBe(false)
  })
})

describe('resolveFilter', () => {
  const shelf: ShelfView = { id: '6f1c0000-0000-4000-8000-000000000000', name: 'To read', books: [] }

  it('keeps a shelf filter that names one of the reader’s shelves, and reads any other shelf- value as all', () => {
    expect(resolveFilter(shelfFilter(shelf.id), [shelf])).toBe(shelfFilter(shelf.id))
    expect(resolveFilter(shelfFilter(shelf.id), [])).toBe('all')
    expect(resolveFilter('shelf-6f1c0000-0000-4000-8000-00000000ffff', [shelf])).toBe('all')
    expect(resolveFilter('shelf-nonsense', [shelf])).toBe('all')
  })

  it('leaves the other filters alone', () => {
    for (const filter of ['all', 'audio', 'inner-path', 'unknown-collection']) {
      expect(resolveFilter(filter, [shelf])).toBe(filter)
    }
  })
})
