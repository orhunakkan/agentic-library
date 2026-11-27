import { describe, expect, it } from 'vitest'
import { type Anchor, contextAt, resolve } from '~/shared/highlights/anchor.ts'
import { type BookPage, bookPages } from '~/shared/highlights/page-text.ts'
import { servedBooks } from '../../../fixtures/served-books'

function page(chapterIndex: number, chapterSlug: string | null, n: number, text: string): BookPage {
  return { chapterIndex, chapterTitle: `C${chapterIndex}`, chapterSlug, page: n, href: '', label: '', text }
}

function anchorFor(pages: BookPage[], at: number, exact: string, nth = 0): Anchor {
  const p = pages[at] as BookPage
  let start = -1
  for (let i = 0; i <= nth; i++) start = p.text.indexOf(exact, start + 1)
  if (start < 0) throw new Error('not on the page')
  return {
    chapter: p.chapterSlug,
    page: p.page,
    start,
    end: start + exact.length,
    ...contextAt(p.text, start, start + exact.length),
  }
}

describe('contextAt', () => {
  it('takes up to 32 units either side, less at the page edges', () => {
    const text = `${'a'.repeat(40)}PASSAGE${'b'.repeat(40)}`
    expect(contextAt(text, 40, 47)).toEqual({ exact: 'PASSAGE', prefix: 'a'.repeat(32), suffix: 'b'.repeat(32) })
    expect(contextAt('xPASSAGEy', 1, 8)).toEqual({ exact: 'PASSAGE', prefix: 'x', suffix: 'y' })
    expect(contextAt('PASSAGE', 0, 7)).toEqual({ exact: 'PASSAGE', prefix: '', suffix: '' })
  })

  it('never cuts a surrogate pair at the edge of the context', () => {
    const text = `😀${'a'.repeat(31)}X${'b'.repeat(31)}😀`
    const { prefix, suffix } = contextAt(text, 33, 34)
    expect(prefix).toBe('a'.repeat(31))
    expect(suffix).toBe('b'.repeat(31))
    expect(prefix.isWellFormed() && suffix.isWellFormed()).toBe(true)
  })
})

describe('resolve', () => {
  const book = [
    page(0, 'one', 1, 'Functions are values. A closure keeps its scope.'),
    page(0, 'one', 2, 'The second page talks about closures and scope.'),
    page(1, 'two', 1, 'Chapter two repeats: a closure keeps its scope.'),
  ]

  it('is ok when the stored offsets still hold the passage', () => {
    const anchor = anchorFor(book, 0, 'closure keeps')
    expect(resolve(anchor, book)).toEqual({ status: 'ok', pageIndex: 0, start: anchor.start, end: anchor.end })
  })

  it('finds a passage that moved within its page', () => {
    const anchor = anchorFor(book, 0, 'closure keeps')
    const edited = [page(0, 'one', 1, `New opening sentence. ${book[0]?.text}`), ...book.slice(1)]
    const found = resolve(anchor, edited)
    expect(found).toMatchObject({ status: 'moved', pageIndex: 0 })
    if (found.status === 'missing') throw new Error()
    expect(edited[0]?.text.slice(found.start, found.end)).toBe('closure keeps')
  })

  it('looks on the chapter’s other pages before the rest of the book', () => {
    const anchor = anchorFor(book, 0, 'closure keeps')
    const edited = [
      page(0, 'one', 1, 'Rewritten.'),
      page(0, 'one', 2, 'Functions are values. A closure keeps its scope.'),
      book[2] as BookPage,
    ]
    expect(resolve(anchor, edited)).toMatchObject({ status: 'moved', pageIndex: 1 })
  })

  it('finds a passage in another chapter, as when a chapter slug was renamed', () => {
    const anchor = anchorFor(book, 0, 'Functions are values')
    const renamed = book.map((p) => (p.chapterSlug === 'one' ? { ...p, chapterSlug: 'one-renamed' } : p))
    expect(resolve(anchor, renamed)).toMatchObject({ status: 'moved', pageIndex: 0, start: 0 })
  })

  it('tells two occurrences apart by the text either side', () => {
    const text = 'First, x = 1 sets it. Later, x = 1 resets it.'
    const pages = [page(0, 'one', 1, text)]
    const second = anchorFor(pages, 0, 'x = 1', 1)
    const shifted = [page(0, 'one', 1, `Intro. ${text}`)]
    const found = resolve(second, shifted)
    expect(found).toMatchObject({ status: 'moved', start: text.lastIndexOf('x = 1') + 'Intro. '.length })
  })

  it('reports a passage the book no longer has as missing', () => {
    const anchor = anchorFor(book, 0, 'Functions are values')
    expect(resolve(anchor, [page(0, 'one', 1, 'Nothing like it.')])).toEqual({ status: 'missing' })
    expect(resolve({ ...anchor, exact: '' }, book)).toEqual({ status: 'missing' })
  })

  it('works on printed pages of paged books', () => {
    const paged = [page(0, null, 7, 'The Sufis say this.'), page(0, null, 8, 'And then the Sufis say that.')]
    const anchor = anchorFor(paged, 1, 'Sufis say that')
    expect(resolve(anchor, paged)).toMatchObject({ status: 'ok', pageIndex: 1 })
    const moved = [page(0, null, 7, 'And then the Sufis say that.'), page(0, null, 8, 'Other text.')]
    expect(resolve(anchor, moved)).toMatchObject({ status: 'moved', pageIndex: 0 })
  })

  it('finds passages at the very edges of a page', () => {
    const p = [page(0, 'one', 1, 'Start of page and end of page')]
    for (const exact of ['Start', 'page', 'Start of page and end of page']) {
      expect(resolve(anchorFor(p, 0, exact), p).status).toBe('ok')
    }
    const last = anchorFor(p, 0, 'page', 1)
    expect(resolve(last, p)).toMatchObject({ status: 'ok', start: p[0]?.text.lastIndexOf('page') })
  })
})

describe('every book the app serves', () => {
  it('has page text, and every sampled passage is found where it was made', () => {
    for (const { book: content } of servedBooks()) {
      const pages = bookPages(content)
      expect(pages.length, content.slug).toBeGreaterThan(0)
      for (const [i, p] of pages.entries()) {
        expect(p.text.isWellFormed(), `${content.slug} ${p.href}`).toBe(true)
        const len = p.text.length
        if (!len) continue
        const spans = [
          [0, Math.min(len, 12)],
          [Math.floor(len / 3), Math.min(len, Math.floor(len / 3) + 80)],
          [0, len],
        ]
        for (const [start, end] of spans as [number, number][]) {
          if (end <= start) continue
          const anchor = { chapter: p.chapterSlug, page: p.page, start, end, ...contextAt(p.text, start, end) }
          const found = resolve(anchor, pages)
          expect(found, `${content.slug} ${p.href} ${start}-${end}`).toEqual({ status: 'ok', pageIndex: i, start, end })
          const lost = resolve({ ...anchor, start: 0, end: 0, page: 99_999 }, pages)
          expect(lost.status, `${content.slug} ${p.href} lost`).toBe('moved')
        }
      }
    }
  })
})
