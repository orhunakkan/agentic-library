import { describe, expect, it } from 'vitest'
import { refFor } from '~/server/books/ref'
import type { CardRow } from '~/server/flashcards/store'
import { toCardView } from '~/server/flashcards/view'
import type { BookPage } from '~/shared/highlights/page-text'

const page = (over: Partial<BookPage>): BookPage => ({
  chapterIndex: 0,
  chapterTitle: 'One',
  chapterSlug: 'one',
  page: 1,
  href: '/read/b/one',
  label: 'Ch. 1 · p. 1',
  text: '',
  ...over,
})
const row: CardRow = {
  id: 'c1',
  book: refFor('b'),
  chapter: 'one',
  page: 2,
  front: 'Front',
  back: 'Back',
  origin: 'quiz',
  box: 3,
  dueAt: new Date('2026-11-12T10:00:00Z'),
  reviewedAt: null,
  createdAt: new Date('2026-11-09T10:00:00Z'),
}

describe('toCardView', () => {
  it('links the source from the book’s current pages, and leaves out the origin and the book', () => {
    const pages = [page({}), page({ page: 2, href: '/read/b/one/2', label: 'Ch. 1 · p. 2' })]
    expect(toCardView(row, pages)).toEqual({
      id: 'c1',
      front: 'Front',
      back: 'Back',
      source: { pageHref: '/read/b/one/2', label: 'Ch. 1 · p. 2' },
      box: 3,
      dueAt: '2026-11-12T10:00:00.000Z',
      createdAt: '2026-11-09T10:00:00.000Z',
    })
  })

  it('finds a printed page, and is null for a page or a book that is gone', () => {
    const printed = [page({ chapterSlug: null, page: 112, href: '/read/b/112', label: 'p. 112' })]
    expect(toCardView({ ...row, chapter: null, page: 112 }, printed).source).toEqual({
      pageHref: '/read/b/112',
      label: 'p. 112',
    })
    expect(toCardView(row, [page({})]).source).toBeNull()
    expect(toCardView(row, null).source).toBeNull()
  })
})
