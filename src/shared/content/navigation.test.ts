import { describe, expect, it } from 'vitest'
import { buildNavigation, chapterPageHref, pagedHref, pageLabel } from './navigation'

const chapters = [
  { title: 'One', pageHrefs: ['/r/b/1', '/r/b/2', '/r/b/3'] },
  { title: 'Two', pageHrefs: ['/r/b/4'] },
  { title: 'Three', pageHrefs: ['/r/b/5', '/r/b/6'] },
]

describe('buildNavigation', () => {
  it('disables previous at the very start of the book', () => {
    const nav = buildNavigation(chapters, 0, 0)
    expect(nav.prev).toEqual({ kind: 'start' })
    expect(nav.next).toEqual({ kind: 'page', href: '/r/b/2' })
  })

  it('moves between pages inside a chapter', () => {
    const nav = buildNavigation(chapters, 0, 1)
    expect(nav.prev).toEqual({ kind: 'page', href: '/r/b/1' })
    expect(nav.next).toEqual({ kind: 'page', href: '/r/b/3' })
  })

  it('names the next chapter on a chapter’s last page', () => {
    expect(buildNavigation(chapters, 0, 2).next).toEqual({ kind: 'chapter', href: '/r/b/4', title: 'Two' })
  })

  it('names the previous chapter on a chapter’s first page and lands on its last page', () => {
    expect(buildNavigation(chapters, 1, 0).prev).toEqual({ kind: 'chapter', href: '/r/b/3', title: 'One' })
  })

  it('marks the end of the book', () => {
    expect(buildNavigation(chapters, 2, 1).next).toEqual({ kind: 'end' })
  })

  it('reports chapter-relative status and book-wide progress', () => {
    const nav = buildNavigation(chapters, 2, 0)
    expect(nav.status).toEqual({ chapterNumber: 3, page: 1, pageCount: 2 })
    expect(nav.progress).toEqual({ position: 5, total: 6 })
  })

  it('lists one dot per page of the current chapter', () => {
    expect(buildNavigation(chapters, 0, 1).dots).toEqual([
      { href: '/r/b/1', current: false },
      { href: '/r/b/2', current: true },
      { href: '/r/b/3', current: false },
    ])
  })
})

describe('hrefs', () => {
  it('builds paged reader urls from printed page numbers', () => {
    expect(pagedHref('sozler', 27)).toBe('/read/sozler/27')
  })

  it('omits the page suffix on a chapter’s first screen page', () => {
    expect(chapterPageHref('prizma', 'intro', 1)).toBe('/read/prizma/intro')
    expect(chapterPageHref('prizma', 'intro', 3)).toBe('/read/prizma/intro/3')
  })
})

describe('pageLabel', () => {
  it('names a screen page by chapter number and a printed page by its number', () => {
    expect(pageLabel({ chapterIndex: 3, page: 2 })).toBe('Ch. 4 · p. 2')
    expect(pageLabel({ printedPage: 112 })).toBe('p. 112')
  })
})
