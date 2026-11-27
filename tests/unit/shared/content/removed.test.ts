import { describe, expect, it } from 'vitest'
import { buildLibrary } from '~/shared/content/library'
import { catalogWithoutRemoved, removedShelfBooks, withoutRemoved } from '~/shared/content/removed'
import { fixtureCatalog } from '../../../fixtures/catalog'

const library = buildLibrary(fixtureCatalog)

describe('withoutRemoved', () => {
  it('gives the same library back when nothing is removed', () => {
    expect(withoutRemoved(library, new Set())).toBe(library)
  })

  it('leaves a removed book out of its series, and counts what is left', () => {
    const out = withoutRemoved(library, new Set(['essays']))
    expect(out.shelves.find((s) => s.slug === 'emerson')?.books.map((b) => b.slug)).toEqual(['representative-men'])
    expect(out.stats).toEqual({ books: 5, series: 4, audiobooks: 1 })
    expect(out.collections.find((c) => c.slug === 'classics')).toMatchObject({ bookCount: 3, seriesCount: 3 })
  })

  it('takes the Audio tag off a series whose only audiobook was removed', () => {
    const out = withoutRemoved(library, new Set(['essays']))
    expect(out.shelves.find((s) => s.slug === 'emerson')?.hasAudio).toBe(false)
  })

  it('drops a series with no books left, and a collection with no series left', () => {
    const out = withoutRemoved(library, new Set(['confessions', 'rumi', 'walden']))
    expect(out.shelves.map((s) => s.slug)).toEqual(['emerson', 'stoic-classics'])
    expect(out.collections.map((c) => [c.slug, c.bookCount, c.seriesCount])).toEqual([['classics', 3, 2]])
    expect(out.stats).toEqual({ books: 3, series: 2, audiobooks: 1 })
  })

  it('keeps every collection its hue for everyone else', () => {
    const out = withoutRemoved(library, new Set(['confessions', 'rumi']))
    expect(out.collections.map((c) => [c.slug, c.hue])).toEqual([['classics', 'violet']])
  })

  it('ignores a slug the catalogue doesn’t have', () => {
    const out = withoutRemoved(library, new Set(['no-such-book']))
    expect(out.stats).toEqual(library.stats)
    expect(out.shelves).toEqual(library.shelves)
  })

  it('leaves nothing when every book is removed', () => {
    const out = withoutRemoved(library, new Set(fixtureCatalog.books.map((b) => b.slug)))
    expect(out).toEqual({ shelves: [], collections: [], stats: { books: 0, series: 0, audiobooks: 0 } })
  })
})

describe('removedShelfBooks', () => {
  it('lists the removed books the catalogue has, as cards, by title', () => {
    const out = removedShelfBooks(fixtureCatalog, new Set(['walden', 'essays', 'gone']))
    expect(out.map((b) => [b.slug, b.href])).toEqual([
      ['essays', '/library/emerson/essays'],
      ['walden', '/library/walden/walden'],
    ])
  })

  it('is empty when nothing is removed', () => {
    expect(removedShelfBooks(fixtureCatalog, new Set())).toEqual([])
  })
})

describe('catalogWithoutRemoved', () => {
  it('gives the same catalogue back when nothing is removed', () => {
    expect(catalogWithoutRemoved(fixtureCatalog, new Set())).toBe(fixtureCatalog)
  })

  it('leaves the removed books out, and a series only when none of its books is left', () => {
    const out = catalogWithoutRemoved(fixtureCatalog, new Set(['walden', 'essays']))
    expect(out.books.map((b) => b.slug)).not.toContain('walden')
    expect(out.books.map((b) => b.slug)).not.toContain('essays')
    expect(out.series.map((s) => s.slug)).toEqual(['emerson', 'inner-path', 'stoic-classics'])
    expect(out.collections).toBe(fixtureCatalog.collections)
  })
})
