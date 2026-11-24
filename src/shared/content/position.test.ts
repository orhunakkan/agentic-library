import { describe, expect, it } from 'vitest'
import { privateBookSlug } from './book-slug'
import {
  fromStored,
  pageOf,
  parsePosition,
  positionFromHref,
  positionKey,
  readerParams,
  samePosition,
  toStored,
} from './position'

describe('positionFromHref', () => {
  it('reads a chapter book’s first page and later pages', () => {
    expect(positionFromHref('/read/emma/chapter-6', 'chapter')).toEqual({ chapter: 'chapter-6', page: 1 })
    expect(positionFromHref('/read/emma/chapter-6/2', 'chapter')).toEqual({ chapter: 'chapter-6', page: 2 })
  })

  it('reads a chapter titled with digits as a chapter, not a printed page', () => {
    expect(positionFromHref('/read/essays/12', 'chapter')).toEqual({ chapter: '12', page: 1 })
  })

  it('reads a paged book’s printed page', () => {
    expect(positionFromHref('/read/confessions/112', 'paged')).toEqual({ printedPage: 112 })
  })

  it('reads a page of digits only when the book’s kind is known', () => {
    expect(positionFromHref('/read/essays/12', null)).toBeNull()
    expect(positionFromHref('/read/emma/chapter-6/2', null)).toEqual({ chapter: 'chapter-6', page: 2 })
  })

  it('is null for anything else', () => {
    for (const href of ['/library', '/read/emma', '/read/emma/c/0', '/read/emma/c/2/3', '/books/emma/c', 'x'])
      expect(positionFromHref(href, 'chapter')).toBeNull()
    expect(positionFromHref('/read/confessions/112/2', 'paged')).toBeNull()
  })
})

describe('parsePosition', () => {
  it('reads a page of a chapter and a printed page', () => {
    expect(parsePosition({ chapter: 'chapter-6', page: 2 })).toEqual({ chapter: 'chapter-6', page: 2 })
    expect(parsePosition({ chapter: '12', page: 1 })).toEqual({ chapter: '12', page: 1 })
    expect(parsePosition({ printedPage: 112 })).toEqual({ printedPage: 112 })
  })

  it('refuses anything else', () => {
    for (const value of [
      null,
      'chapter-6',
      [],
      {},
      { printedPage: 0 },
      { printedPage: 1.5 },
      { printedPage: 100_001 },
      { printedPage: 3, chapter: 'a' },
      { chapter: 'Not A Slug', page: 1 },
      { chapter: 'a', page: 0 },
      { chapter: 'a'.repeat(201), page: 1 },
      { chapter: 'a', page: 1, extra: true },
    ])
      expect(parsePosition(value)).toBeNull()
  })
})

describe('samePosition', () => {
  it('matches the same page only', () => {
    expect(samePosition({ chapter: 'a', page: 2 }, { chapter: 'a', page: 2 })).toBe(true)
    expect(samePosition({ printedPage: 4 }, { printedPage: 4 })).toBe(true)
    expect(samePosition({ chapter: 'a', page: 2 }, { chapter: 'a', page: 3 })).toBe(false)
    expect(samePosition({ chapter: 'a', page: 2 }, { chapter: 'b', page: 2 })).toBe(false)
    expect(samePosition({ printedPage: 4 }, { printedPage: 5 })).toBe(false)
    expect(samePosition({ chapter: '4', page: 1 }, { printedPage: 4 })).toBe(false)
    expect(samePosition({ printedPage: 4 }, { chapter: '4', page: 1 })).toBe(false)
  })
})

describe('positionKey', () => {
  it('tells apart a chapter of digits from a printed page', () => {
    expect(positionKey({ chapter: 'a', page: 2 })).toBe('a/2')
    expect(positionKey({ printedPage: 4 })).toBe('4')
    expect(positionKey({ chapter: '4', page: 1 })).not.toBe(positionKey({ printedPage: 4 }))
  })
})

describe('toStored and fromStored', () => {
  it('stores a printed page with no chapter, and reads it back', () => {
    expect(toStored({ printedPage: 9 })).toEqual({ chapter: null, page: 9 })
    expect(toStored({ chapter: 'a', page: 2 })).toEqual({ chapter: 'a', page: 2 })
    expect(fromStored(null, 9)).toEqual({ printedPage: 9 })
    expect(fromStored('a', 2)).toEqual({ chapter: 'a', page: 2 })
  })

  it('gives the page number either way', () => {
    expect(pageOf({ printedPage: 9 })).toBe(9)
    expect(pageOf({ chapter: 'a', page: 2 })).toBe(2)
  })
})

describe('readerParams', () => {
  it('reads chapter, screen-page, printed-page and private-book addresses', () => {
    expect(readerParams('/read/essays/history')).toEqual({ book: 'essays', part: 'history' })
    expect(readerParams('/read/essays/history/3')).toEqual({ book: 'essays', part: 'history', n: '3' })
    expect(readerParams('/read/confessions/112')).toEqual({ book: 'confessions', part: '112' })
    expect(readerParams(`/read/${privateBookSlug('0f8e2a8c-4c4b-4a3e-9d8c-6f1b2a3c4d5e')}/chapter-1/2`)).toEqual({
      book: privateBookSlug('0f8e2a8c-4c4b-4a3e-9d8c-6f1b2a3c4d5e'),
      part: 'chapter-1',
      n: '2',
    })
  })

  it('is null for anything else', () => {
    for (const href of [
      '/read/essays',
      '/library/essays',
      '/read/essays/history/3/4',
      '/read/essays/history?x=1',
      '/read/essays/history#highlight-1',
      'https://example.com/read/essays/history',
      '',
    ])
      expect(readerParams(href), href).toBeNull()
  })
})
