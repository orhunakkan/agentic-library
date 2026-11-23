import { describe, expect, it } from 'vitest'
import { groupByChapter, type HighlightView, inReadingOrder } from './group.ts'

function view(
  id: string,
  at: { chapterIndex: number; position: number; start: number } | null,
  createdAt = '2026-11-04T10:00:00.000Z',
): HighlightView {
  return {
    id,
    color: 'yellow',
    note: null,
    text: id,
    status: at ? 'ok' : 'missing',
    place: at && {
      chapterIndex: at.chapterIndex,
      chapterTitle: `Chapter ${at.chapterIndex + 1}`,
      chapter: `c${at.chapterIndex}`,
      page: 1,
      pageHref: '/read/b/c',
      href: `/read/b/c#highlight-${id}`,
      label: `Ch. ${at.chapterIndex + 1} · p. 1`,
      position: at.position,
      start: at.start,
      end: at.start + 1,
    },
    createdAt,
    updatedAt: createdAt,
  }
}

describe('inReadingOrder', () => {
  it('sorts by page, then offset, then age, with missing passages last', () => {
    const list = [
      view('lost-new', null, '2026-11-04T12:00:00.000Z'),
      view('p2', { chapterIndex: 0, position: 2, start: 0 }),
      view('p1b', { chapterIndex: 0, position: 1, start: 50 }),
      view('lost-old', null, '2026-11-04T09:00:00.000Z'),
      view('p1a-new', { chapterIndex: 0, position: 1, start: 5 }, '2026-11-04T11:00:00.000Z'),
      view('p1a-old', { chapterIndex: 0, position: 1, start: 5 }),
    ]
    expect(inReadingOrder(list).map((h) => h.id)).toEqual(['p1a-old', 'p1a-new', 'p1b', 'p2', 'lost-old', 'lost-new'])
  })
})

describe('groupByChapter', () => {
  it('groups by chapter in reading order and keeps missing passages apart', () => {
    const { chapters, missing } = groupByChapter([
      view('c2', { chapterIndex: 2, position: 9, start: 0 }),
      view('gone', null),
      view('c0b', { chapterIndex: 0, position: 1, start: 0 }),
      view('c0a', { chapterIndex: 0, position: 0, start: 3 }),
    ])
    expect(chapters.map((c) => [c.chapterIndex, c.chapterTitle, c.highlights.map((h) => h.id)])).toEqual([
      [0, 'Chapter 1', ['c0a', 'c0b']],
      [2, 'Chapter 3', ['c2']],
    ])
    expect(missing.map((h) => h.id)).toEqual(['gone'])
  })

  it('is empty without highlights', () => {
    expect(groupByChapter([])).toEqual({ chapters: [], missing: [] })
  })
})
