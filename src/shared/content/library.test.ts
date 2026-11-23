import { describe, expect, it } from 'vitest'
import { fixtureCatalog } from '../../../tests/fixtures/catalog'
import { buildLibrary } from './library'

describe('buildLibrary', () => {
  const library = buildLibrary(fixtureCatalog)

  it('puts the paged collection first, then series alphabetically', () => {
    expect(library.shelves.map((s) => s.slug)).toEqual(['inner-path', 'emerson', 'stoic-classics', 'walden'])
  })

  it('orders books by volume within a shelf', () => {
    expect(library.shelves[1]?.books.map((b) => b.slug)).toEqual(['essays', 'representative-men'])
  })

  it('links books to their detail page and generated cover', () => {
    expect(library.shelves[1]?.books[0]).toMatchObject({
      href: '/library/emerson/essays',
      coverUrl: '/covers/essays.svg',
      hasAudio: true,
      image: null,
    })
  })

  it('gives a book with its own cover the image, at its hashed address, as its cover URL too', () => {
    const image = { src: '/covers/representative-men-abcdef12.jpg', width: 600, height: 900 }
    expect(library.shelves[1]?.books[1]).toMatchObject({ coverUrl: image.src, image })
  })

  it('flags a shelf as having audio when any of its books does', () => {
    expect(library.shelves.find((s) => s.slug === 'emerson')?.hasAudio).toBe(true)
    expect(library.shelves.find((s) => s.slug === 'stoic-classics')?.hasAudio).toBe(false)
  })

  it('counts books, series and audiobooks at book level', () => {
    expect(library.stats).toEqual({ books: 6, series: 4, audiobooks: 2 })
  })

  it('lists collections in order with their book and series counts', () => {
    expect(library.collections.map((c) => [c.slug, c.bookCount, c.seriesCount])).toEqual([
      ['inner-path', 2, 1],
      ['classics', 4, 3],
    ])
  })

  it('gives each collection and its shelves a hue: amber for the warm one, violet for the next', () => {
    expect(library.collections.map((c) => [c.slug, c.hue])).toEqual([
      ['inner-path', 'amber'],
      ['classics', 'violet'],
    ])
    expect(library.shelves.map((s) => [s.slug, s.hue])).toEqual([
      ['inner-path', 'amber'],
      ['emerson', 'violet'],
      ['stoic-classics', 'violet'],
      ['walden', 'violet'],
    ])
  })
})
