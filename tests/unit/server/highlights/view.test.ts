import { describe, expect, it } from 'vitest'
import type { HighlightRow } from '~/server/highlights/store'
import { toView, toViews } from '~/server/highlights/view'
import type { BookPage } from '~/shared/highlights/page-text'

const pages: BookPage[] = [
  {
    chapterIndex: 0,
    chapterTitle: 'One',
    chapterSlug: 'one',
    page: 1,
    href: '/read/b/one',
    label: 'Ch. 1 · p. 1',
    text: 'the quick brown fox',
  },
  {
    chapterIndex: 1,
    chapterTitle: 'Two',
    chapterSlug: 'two',
    page: 1,
    href: '/read/b/two',
    label: 'Ch. 2 · p. 1',
    text: 'jumps over the lazy dog',
  },
]

const row = (over: Partial<HighlightRow> = {}): HighlightRow => ({
  id: 'h1',
  chapter: 'one',
  page: 1,
  start: 4,
  end: 9,
  exact: 'quick',
  prefix: 'the ',
  suffix: ' brown',
  color: 'green',
  note: 'a note',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
  ...over,
})

describe('toView', () => {
  it('places a highlight on its page and links to it, sending nothing else of the stored row', () => {
    const view = toView(row(), pages)
    expect(view).toEqual({
      id: 'h1',
      color: 'green',
      note: 'a note',
      text: 'quick',
      status: 'ok',
      place: {
        chapterIndex: 0,
        chapterTitle: 'One',
        chapter: 'one',
        page: 1,
        pageHref: '/read/b/one',
        href: '/read/b/one#highlight-h1',
        label: 'Ch. 1 · p. 1',
        position: 0,
        start: 4,
        end: 9,
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    })
  })

  it('lists a passage that is gone, or a book that has left the library, as missing with no place', () => {
    expect(toView(row({ exact: 'zebra' }), pages)).toMatchObject({ status: 'missing', place: null, text: 'zebra' })
    expect(toView(row(), null)).toMatchObject({ status: 'missing', place: null })
  })

  it('shows a colour the code no longer knows as the default one', () => {
    expect(toView(row({ color: 'ultraviolet' }), pages).color).toBe('yellow')
  })
})

describe('toViews', () => {
  it('sorts by reading order, not by when each was made', () => {
    const later = row({
      id: 'early-text',
      chapter: 'one',
      start: 0,
      end: 3,
      exact: 'the',
      prefix: '',
      suffix: ' quick',
    })
    const second = row({
      id: 'chapter-two',
      chapter: 'two',
      start: 0,
      end: 5,
      exact: 'jumps',
      prefix: '',
      suffix: ' over',
    })
    const views = toViews([second, row(), later], pages)
    expect(views.map((v) => v.id)).toEqual(['early-text', 'h1', 'chapter-two'])
  })
})
