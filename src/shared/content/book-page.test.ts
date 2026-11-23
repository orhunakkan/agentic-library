import { describe, expect, it } from 'vitest'
import { chapterFixture, pagedFixture } from '../../../tests/fixtures/books'
import { fixtureCatalog } from '../../../tests/fixtures/catalog'
import { buildBookPage } from './book-page'
import type { AudioBook } from './schema'

const audio: AudioBook = {
  bookSlug: 'essays',
  credit: 'LibriVox',
  sourceUrl: 'https://librivox.org',
  episodes: [
    {
      id: 'ep_1',
      slug: 'history',
      title: 'History',
      number: 1,
      durationMs: 2000,
      audioUrl: 'https://a/1.mp3',
      chapterRef: 'history',
    },
    { id: 'ep_2', slug: 'self', title: 'Self-Reliance', number: 2, durationMs: 3000, audioUrl: 'https://a/2.mp3' },
  ],
}

describe('buildBookPage', () => {
  it('returns null when the book is not in that series', () => {
    expect(buildBookPage(fixtureCatalog, chapterFixture, null, 'walden', 'essays')).toBeNull()
  })

  it('numbers the table of contents and links into the reader', () => {
    const page = buildBookPage(fixtureCatalog, chapterFixture, null, 'emerson', 'essays')
    expect(page?.toc).toEqual([
      { number: 1, title: 'History', href: '/read/essays/history' },
      { number: 2, title: 'Self-Reliance', href: '/read/essays/self-reliance' },
    ])
    expect(page?.startHref).toBe('/read/essays/history')
  })

  it('sends paged books back to their collection’s series page and chapter books back to the Library', () => {
    expect(buildBookPage(fixtureCatalog, pagedFixture, null, 'inner-path', 'confessions')?.back).toEqual({
      href: '/library/inner-path',
      label: 'The Inner Path',
    })
    expect(buildBookPage(fixtureCatalog, chapterFixture, null, 'emerson', 'essays')?.back).toEqual({
      href: '/library',
      label: 'Library',
    })
  })

  it('carries the hue of the book’s collection', () => {
    expect(buildBookPage(fixtureCatalog, pagedFixture, null, 'inner-path', 'confessions')?.hue).toBe('amber')
    expect(buildBookPage(fixtureCatalog, chapterFixture, null, 'emerson', 'essays')?.hue).toBe('violet')
  })

  it('lists the following volumes as siblings, at most four', () => {
    const page = buildBookPage(fixtureCatalog, chapterFixture, null, 'emerson', 'essays')
    expect(page?.siblings.map((s) => s.slug)).toEqual(['representative-men'])
  })

  it('falls back to earlier volumes on the last volume', () => {
    const page = buildBookPage(fixtureCatalog, pagedFixture, null, 'inner-path', 'rumi')
    expect(page?.siblings.map((s) => s.slug)).toEqual(['confessions'])
  })

  it('gives the siblings and the player their own cover, or the generated one', () => {
    const page = buildBookPage(fixtureCatalog, chapterFixture, audio, 'emerson', 'essays')
    expect(page?.siblings[0]?.image?.src).toBe('/covers/representative-men-abcdef12.jpg')
    expect(page?.audio?.book).toMatchObject({ coverUrl: '/covers/essays.svg', image: null })
    const own = buildBookPage(fixtureCatalog, chapterFixture, audio, 'emerson', 'representative-men')
    expect(own?.audio?.book).toMatchObject({
      coverUrl: '/covers/representative-men-abcdef12.jpg',
      image: { src: '/covers/representative-men-abcdef12.jpg', width: 600, height: 900 },
    })
  })

  it('attaches the audiobook with episode hrefs into the reader', () => {
    const page = buildBookPage(fixtureCatalog, chapterFixture, audio, 'emerson', 'essays')
    expect(page?.audio?.totalMs).toBe(5000)
    expect(page?.audio?.episodes.map((e) => e.pageHref)).toEqual(['/read/essays/history', '/read/essays/history'])
  })
})
