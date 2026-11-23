import { describe, expect, it } from 'vitest'
import { type Anchor, contextAt } from '../highlights/anchor.ts'
import type { BookPage } from '../highlights/page-text.ts'
import { type BookmarkView, inReadingOrder, OPENING_UNITS, onPage, pageAnchor, resolveBookmark } from './bookmarks.ts'

function page(chapterIndex: number, chapterSlug: string | null, n: number, text: string): BookPage {
  return {
    chapterIndex,
    chapterTitle: `C${chapterIndex}`,
    chapterSlug,
    page: n,
    href: `/read/b/${chapterSlug}/${n}`,
    label: '',
    text,
  }
}

const anchorOn = (p: BookPage): Anchor => ({ chapter: p.chapterSlug, page: p.page, ...pageAnchor(p.text) })

describe('pageAnchor', () => {
  it('starts at the first non-space character and takes 64 units, with contextAt’s prefix and suffix', () => {
    const text = `\n   ${'a'.repeat(70)}`
    const anchor = pageAnchor(text)
    expect(anchor).toMatchObject({ start: 4, end: 4 + OPENING_UNITS, exact: 'a'.repeat(64) })
    const { prefix, suffix } = contextAt(text, 4, 68)
    expect([anchor.prefix, anchor.suffix]).toEqual([prefix, suffix])
    expect(anchor.prefix).toBe('\n   ')
    expect(anchor.suffix).toBe('a'.repeat(6))
  })

  it('takes what there is on a short page', () => {
    expect(pageAnchor('  Short.')).toEqual({ start: 2, end: 8, exact: 'Short.', prefix: '  ', suffix: '' })
  })

  it('never splits a surrogate pair at the cut', () => {
    const text = `${'a'.repeat(63)}😀 and more`
    const anchor = pageAnchor(text)
    expect(anchor.end).toBe(63)
    expect(anchor.exact).toBe('a'.repeat(63))
    expect(anchor.exact.isWellFormed()).toBe(true)
    expect(pageAnchor(`${'a'.repeat(62)}😀 more`).exact).toBe(`${'a'.repeat(62)}😀`)
  })

  it('gives the empty anchor for a blank page', () => {
    expect(pageAnchor(' \n\t ')).toEqual({ start: 0, end: 0, exact: '', prefix: '', suffix: '' })
    expect(pageAnchor('')).toEqual({ start: 0, end: 0, exact: '', prefix: '', suffix: '' })
  })
})

describe('resolveBookmark', () => {
  const book = [
    page(0, 'one', 1, 'The first page of the book opens here and goes on for a while.'),
    page(0, 'one', 2, 'It was a bright cold day in April, and the clocks were striking thirteen. More follows.'),
    page(1, 'two', 1, 'Chapter two.'),
  ]

  it('is ok on the unchanged page', () => {
    expect(resolveBookmark(anchorOn(book[1] as BookPage), book)).toMatchObject({ status: 'ok', pageIndex: 1 })
  })

  it('is moved, to the right page, when a re-import moved the opening words to the previous page', () => {
    const anchor = anchorOn(book[1] as BookPage)
    const reimported = [
      page(0, 'one', 1, `${book[0]?.text} ${book[1]?.text}`),
      page(0, 'one', 2, 'A new second page.'),
      book[2] as BookPage,
    ]
    expect(resolveBookmark(anchor, reimported)).toMatchObject({ status: 'moved', pageIndex: 0 })
  })

  it('is missing when the words are gone', () => {
    const anchor = anchorOn(book[1] as BookPage)
    expect(resolveBookmark(anchor, [book[0] as BookPage, book[2] as BookPage])).toEqual({ status: 'missing' })
  })

  it('finds an empty anchor on its stored page while it exists, and nowhere once it doesn’t', () => {
    const blank = [book[0] as BookPage, page(0, 'one', 2, '   ')]
    const anchor = anchorOn(blank[1] as BookPage)
    expect(anchor.exact).toBe('')
    expect(resolveBookmark(anchor, blank)).toEqual({ status: 'ok', pageIndex: 1, start: 0, end: 0 })
    expect(resolveBookmark(anchor, [book[0] as BookPage])).toEqual({ status: 'missing' })
  })
})

function view(id: string, position: number | null, createdAt = '2026-11-05T10:00:00.000Z'): BookmarkView {
  return {
    id,
    status: position === null ? 'missing' : 'ok',
    opening: id,
    place:
      position === null
        ? null
        : {
            chapterIndex: 0,
            chapterTitle: 'C0',
            chapter: 'one',
            page: position + 1,
            pageHref: `/read/b/one/${position + 1}`,
            label: `Ch. 1 · p. ${position + 1}`,
            position,
          },
    createdAt,
  }
}

describe('inReadingOrder and onPage', () => {
  it('sorts by position then age, with the missing ones last, oldest first', () => {
    const list = [
      view('lost-new', null, '2026-11-05T12:00:00.000Z'),
      view('p3', 3),
      view('p1-new', 1, '2026-11-05T11:00:00.000Z'),
      view('lost-old', null, '2026-11-05T09:00:00.000Z'),
      view('p1-old', 1),
    ]
    expect(inReadingOrder(list).map((b) => b.id)).toEqual(['p1-old', 'p1-new', 'p3', 'lost-old', 'lost-new'])
    expect(list[0]?.id).toBe('lost-new')
  })

  it('orders two bookmarks made at the same instant by id, so the list never reshuffles between loads', () => {
    const list = [view('b', 1), view('a', 1), view('lost-b', null), view('lost-a', null)]
    expect(inReadingOrder(list).map((b) => b.id)).toEqual(['a', 'b', 'lost-a', 'lost-b'])
  })

  it('finds the bookmarks on a page, never the missing ones', () => {
    const list = [view('a', 1), view('b', 2), view('c', 1), view('lost', null)]
    expect(onPage(list, '/read/b/one/2').map((b) => b.id)).toEqual(['a', 'c'])
    expect(onPage(list, '/read/b/one/9')).toEqual([])
  })
})
