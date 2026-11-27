import { describe, expect, it } from 'vitest'
import type { BookmarkRow } from '~/server/bookmarks/store.ts'
import { toBookmarkView } from '~/server/bookmarks/view.ts'
import type { BookPage } from '~/shared/highlights/page-text'

const PAGE: BookPage = {
  chapterIndex: 0,
  chapterTitle: '1. Chapter 1',
  chapterSlug: 'chapter-1',
  page: 1,
  href: '/read/b/chapter-1/1',
  label: 'Ch. 1 · p. 1',
  text: 'It was a bright\n\tcold day in April.',
}

const row = (exact: string): BookmarkRow => ({
  id: '6f1c0000-0000-4000-8000-000000000001',
  chapter: 'chapter-1',
  page: 1,
  start: 0,
  end: exact.length,
  exact,
  prefix: '',
  suffix: '',
  createdAt: new Date('2026-11-05T10:00:00.000Z'),
})

describe('toBookmarkView', () => {
  it('shows the opening words on one line, with the page’s runs of spaces, tabs and newlines collapsed', () => {
    expect(toBookmarkView(row('It was a bright\n\tcold day'), [PAGE])).toEqual({
      id: '6f1c0000-0000-4000-8000-000000000001',
      status: 'ok',
      opening: 'It was a bright cold day',
      place: {
        chapterIndex: 0,
        chapterTitle: '1. Chapter 1',
        chapter: 'chapter-1',
        page: 1,
        pageHref: '/read/b/chapter-1/1',
        label: 'Ch. 1 · p. 1',
        position: 0,
      },
      createdAt: '2026-11-05T10:00:00.000Z',
    })
  })

  it('trims the opening words of a bookmark found nowhere too', () => {
    expect(toBookmarkView(row('  Words  in no book\n'), [PAGE])).toMatchObject({
      status: 'missing',
      opening: 'Words in no book',
      place: null,
    })
  })
})
