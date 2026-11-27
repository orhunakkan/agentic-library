import { describe, expect, it } from 'vitest'
import { buildReaderView, firstReadingHref, labelOf, positionOf } from '~/shared/content/reader-view'
import { chapterFixture, metaFor, pagedFixture } from '../../../fixtures/books'
import { fixtureCatalog } from '../../../fixtures/catalog'

describe('positionOf and labelOf', () => {
  const ctxFor = (slug: string) => ({ meta: metaFor(slug), catalog: fixtureCatalog })

  it('give a chapter page as the endpoints take it and as the chips say it', () => {
    const view = buildReaderView(ctxFor('essays'), chapterFixture, 'history', '3')
    if (!view) throw new Error('no view')
    expect(positionOf(view)).toEqual({ chapter: 'history', page: 3 })
    expect(labelOf(view)).toBe('Ch. 1 · p. 3')
  })

  it('give a paged book’s printed page', () => {
    const view = buildReaderView(ctxFor('confessions'), pagedFixture, '10')
    if (!view) throw new Error('no view')
    expect(positionOf(view)).toEqual({ printedPage: 10 })
    expect(labelOf(view)).toBe('p. 10')
  })
})

const ctx = (slug: string) => ({ meta: metaFor(slug), catalog: fixtureCatalog })

describe('buildReaderView — paged books', () => {
  it('returns null for a page outside the book', () => {
    expect(buildReaderView(ctx('confessions'), pagedFixture, '6')).toBeNull()
    expect(buildReaderView(ctx('confessions'), pagedFixture, '12')).toBeNull()
    expect(buildReaderView(ctx('confessions'), pagedFixture, 'intro')).toBeNull()
  })

  it('locates the chapter and marks the chapter-start page', () => {
    const view = buildReaderView(ctx('confessions'), pagedFixture, '9')
    expect(view?.chapterIndex).toBe(1)
    expect(view?.isChapterStart).toBe(true)
    expect(buildReaderView(ctx('confessions'), pagedFixture, '10')?.isChapterStart).toBe(false)
  })

  it('highlights sub-sections that start on the page and adds them to the breadcrumbs and title', () => {
    const view = buildReaderView(ctx('confessions'), pagedFixture, '10')
    expect(view?.toc[1]?.children.map((c) => c.onPage)).toEqual([true, false])
    expect(view?.breadcrumbs).toEqual(['The Confessions of Al Ghazzali', 'The Search', 'Doubt'])
    expect(view?.documentTitle).toBe('The Confessions of Al Ghazzali › The Search › Doubt | The Inner Path')
  })

  it('links TOC entries to printed pages', () => {
    const view = buildReaderView(ctx('confessions'), pagedFixture, '7')
    expect(view?.toc.map((c) => c.href)).toEqual(['/read/confessions/7', '/read/confessions/9'])
    expect(view?.toc[1]?.children[1]?.href).toBe('/read/confessions/11')
  })

  it('computes navigation over printed pages', () => {
    const view = buildReaderView(ctx('confessions'), pagedFixture, '8')
    expect(view?.nav.next).toEqual({ kind: 'chapter', href: '/read/confessions/9', title: 'The Search' })
    expect(view?.nav.progress).toEqual({ position: 2, total: 5 })
  })
})

describe('buildReaderView — chapter books', () => {
  it('serves the first screen page without a suffix and later ones with it', () => {
    expect(buildReaderView(ctx('essays'), chapterFixture, 'history')?.page).toEqual({
      kind: 'chapter',
      html: '<p>h1</p>',
    })
    expect(buildReaderView(ctx('essays'), chapterFixture, 'history', '3')?.page).toEqual({
      kind: 'chapter',
      html: '<p>h3</p>',
    })
  })

  it('rejects unknown chapters, out-of-range pages and an explicit "/1"', () => {
    expect(buildReaderView(ctx('essays'), chapterFixture, 'nope')).toBeNull()
    expect(buildReaderView(ctx('essays'), chapterFixture, 'history', '4')).toBeNull()
    expect(buildReaderView(ctx('essays'), chapterFixture, 'history', '1')).toBeNull()
  })

  it('uses "<Chapter> | <site>" as the document title', () => {
    expect(buildReaderView(ctx('essays'), chapterFixture, 'self-reliance')?.documentTitle).toBe('Self-Reliance | Folio')
  })

  it('computes chapter-relative status', () => {
    const view = buildReaderView(ctx('essays'), chapterFixture, 'history', '2')
    expect(view?.nav.status).toEqual({ chapterNumber: 1, page: 2, pageCount: 3 })
    expect(view?.canonicalPath).toBe('/read/essays/history/2')
  })
})

describe('buildReaderView — the book’s cover', () => {
  it('gives the catalogue image and its address, or the generated cover', () => {
    const own = buildReaderView(ctx('representative-men'), chapterFixture, 'history')?.book
    expect(own).toMatchObject({
      coverUrl: '/covers/representative-men-abcdef12.jpg',
      image: { src: '/covers/representative-men-abcdef12.jpg', width: 600, height: 900 },
    })
    expect(buildReaderView(ctx('essays'), chapterFixture, 'history')?.book).toMatchObject({
      coverUrl: '/covers/essays.svg',
      image: null,
    })
  })

  it('takes the cover the context names instead, as private books do', () => {
    const view = buildReaderView(
      { ...ctx('representative-men'), coverUrl: 'data:x', image: null },
      chapterFixture,
      'history',
    )
    expect(view?.book).toMatchObject({ coverUrl: 'data:x', image: null })
  })
})

describe('firstReadingHref', () => {
  it('opens paged books at the first chapter’s start page and chapter books at the first chapter', () => {
    expect(firstReadingHref(pagedFixture)).toBe('/read/confessions/7')
    expect(firstReadingHref(chapterFixture)).toBe('/read/essays/history')
  })
})
