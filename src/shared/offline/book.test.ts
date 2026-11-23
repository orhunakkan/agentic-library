import { describe, expect, it } from 'vitest'
import { privateBookSlug } from '~/shared/content/book-slug'
import { chapterFixture, metaFor, pagedFixture } from '../../../tests/fixtures/books'
import { fixtureCatalog } from '../../../tests/fixtures/catalog'
import { privateReaderContext } from '../content/private-book'
import { buildReaderView } from '../content/reader-view'
import type { BookContent } from '../content/schema'
import { isOfflineSlug, type OfflineBook, offlineBookUrl, offlineCoverUrl, parseOfflineBook, trimCatalog } from './book'

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e'

function catalogueBook(): OfflineBook {
  const meta = metaFor('essays')
  return {
    v: 1,
    slug: 'essays',
    version: '0123456789abcdef',
    title: meta.title,
    author: meta.author,
    owner: null,
    context: { meta, catalog: trimCatalog(fixtureCatalog, meta) },
    content: chapterFixture,
    cover: meta.cover,
    speech: {
      slug: 'essays',
      title: meta.title,
      author: meta.author,
      href: '/library/emerson/essays',
      coverUrl: '/covers/essays.svg',
      cover: meta.cover,
      image: null,
      language: 'en',
      chapterTitles: ['History', 'Self-Reliance'],
    },
    pictures: ['/images/essays/0123456789ab.png'],
    bytes: 1234,
  }
}

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value))

describe('parseOfflineBook', () => {
  it('takes a whole copy, catalogue or private', () => {
    const book = json(catalogueBook())
    expect(parseOfflineBook(book)).toEqual(book)
    const context = privateReaderContext({ id: ID, title: 'Mine', author: 'Me', language: 'en', chapterCount: 2 })
    const own = json({
      ...catalogueBook(),
      slug: privateBookSlug(ID),
      owner: 'ada',
      context,
      content: { ...chapterFixture, slug: privateBookSlug(ID) },
      speech: { ...catalogueBook().speech, slug: privateBookSlug(ID) },
    })
    expect(parseOfflineBook(own)).toEqual(own)
  })

  it('refuses another version, extra or missing fields, and a bad slug', () => {
    const book = json(catalogueBook())
    expect(parseOfflineBook({ ...book, v: 2 })).toBeNull()
    expect(parseOfflineBook({ ...book, extra: true })).toBeNull()
    const { speech: _speech, ...missing } = book
    expect(parseOfflineBook(missing)).toBeNull()
    for (const slug of ['u-nope', 'Essays', 'nav', '../x', ''])
      expect(parseOfflineBook({ ...book, slug }), slug).toBeNull()
    expect(parseOfflineBook(null)).toBeNull()
    expect(parseOfflineBook([book])).toBeNull()
  })

  it('refuses parts that don’t match the book', () => {
    const book = json(catalogueBook())
    expect(parseOfflineBook({ ...book, version: 'abc' })).toBeNull()
    expect(parseOfflineBook({ ...book, owner: 'ada' })).toBeNull()
    expect(parseOfflineBook({ ...book, content: { ...book.content, slug: 'other' } })).toBeNull()
    expect(parseOfflineBook({ ...book, content: { ...book.content, kind: 'audio' } })).toBeNull()
    expect(parseOfflineBook({ ...book, content: { kind: 'paged', slug: 'essays', chapters: [] } })).toBeNull()
    expect(parseOfflineBook({ ...book, context: { ...book.context, meta: metaFor('walden') } })).toBeNull()
    expect(parseOfflineBook({ ...book, speech: { ...book.speech, slug: 'walden' } })).toBeNull()
    expect(parseOfflineBook({ ...book, cover: null })).toBeNull()
    expect(parseOfflineBook({ ...book, pictures: ['https://elsewhere.test/a.png'] })).toBeNull()
    expect(parseOfflineBook({ ...book, pictures: ['//elsewhere.test/a.png'] })).toBeNull()
    expect(parseOfflineBook({ ...book, bytes: -1 })).toBeNull()
    expect(parseOfflineBook({ ...book, bytes: 1.5 })).toBeNull()
    expect(parseOfflineBook({ ...book, title: 5 })).toBeNull()
    expect(parseOfflineBook({ ...book, slug: privateBookSlug(ID), owner: null })).toBeNull()
  })
})

describe('isOfflineSlug and offlineBookUrl', () => {
  it('take catalogue slugs and private ones, nothing else', () => {
    expect(isOfflineSlug('pride-and-prejudice')).toBe(true)
    expect(isOfflineSlug(privateBookSlug(ID))).toBe(true)
    expect(isOfflineSlug('u-abc')).toBe(false)
    expect(isOfflineSlug('a'.repeat(201))).toBe(false)
    expect(isOfflineSlug(7)).toBe(false)
    expect(offlineBookUrl('essays')).toBe('/offline/essays.json')
  })
})

describe('trimCatalog', () => {
  function pagesOf(content: BookContent): [string, string | undefined][] {
    if (content.kind === 'paged') return content.pages.map((p) => [String(p.pageNumber), undefined])
    return content.chapters.flatMap((c) =>
      c.pages.map((_, i): [string, string | undefined] => [c.slug, i === 0 ? undefined : String(i + 1)]),
    )
  }

  for (const [slug, content] of [
    ['essays', chapterFixture],
    ['confessions', pagedFixture],
  ] as const) {
    it(`gives the same view as the whole catalogue for every page of ${slug}`, () => {
      const meta = metaFor(slug)
      const trimmed = trimCatalog(fixtureCatalog, meta)
      expect(trimmed.books).toEqual([meta])
      expect(trimmed.series).toHaveLength(1)
      expect(trimmed.collections).toHaveLength(1)
      for (const [part, n] of pagesOf(content)) {
        const full = buildReaderView({ meta, catalog: fixtureCatalog }, content, part, n)
        expect(full, `${part}/${n}`).not.toBeNull()
        expect(buildReaderView({ meta, catalog: json(trimmed) }, json(content), part, n)).toEqual(full)
      }
    })
  }
})

describe('offlineCoverUrl', () => {
  it('is the catalogue cover, a private book’s own, or none for an inline one', () => {
    expect(offlineCoverUrl({ meta: metaFor('essays'), catalog: fixtureCatalog })).toBe('/covers/essays.svg')
    const own = privateReaderContext({
      id: ID,
      title: 'Mine',
      author: 'Me',
      language: 'en',
      chapterCount: 1,
      cover: { width: 600, height: 900, sha256: 'ab'.repeat(32), source: 'upload' },
    })
    expect(offlineCoverUrl(own)).toBe(`/account/books/${ID}/cover?v=abababab`)
    const inline = privateReaderContext({ id: ID, title: 'Mine', author: 'Me', language: 'en', chapterCount: 1 })
    expect(offlineCoverUrl(inline)).toBeNull()
  })
})
