import { describe, expect, it } from 'vitest'
import {
  type AudioBookmarkView,
  type EpisodeBookmarkView,
  inListeningOrder,
  momentAnchor,
  tabOrder,
  type VoiceBookmarkView,
} from '~/shared/bookmarks/audio.ts'
import type { BookmarkView } from '~/shared/bookmarks/bookmarks.ts'
import { contextAt } from '~/shared/highlights/anchor.ts'

const place = (position: number, start = 0) => ({
  chapterIndex: 0,
  chapterTitle: 'One',
  chapter: 'one',
  page: position + 1,
  pageHref: `/read/b/one/${position + 1}`,
  label: `Ch. 1 · p. ${position + 1}`,
  position,
  start,
})

const voice = (id: string, at: [number, number] | null, createdAt = '2026-11-05T10:00:00Z'): VoiceBookmarkView => ({
  kind: 'voice',
  id,
  status: at ? 'ok' : 'missing',
  opening: id,
  place: at ? place(at[0], at[1]) : null,
  createdAt,
})

const episode = (id: string, at: [number, number] | null, createdAt = '2026-11-05T10:00:00Z'): EpisodeBookmarkView => ({
  kind: 'episode',
  id,
  status: at ? 'ok' : 'missing',
  positionMs: at?.[1] ?? 5000,
  episode: at ? { id: `e${at[0]}`, number: at[0], title: `Episode ${at[0]}`, durationMs: 600_000 } : null,
  createdAt,
})

const pageBookmark = (id: string, position: number | null, createdAt = '2026-11-05T10:00:00Z'): BookmarkView => {
  const p = position === null ? null : place(position)
  return {
    id,
    status: p ? 'ok' : 'missing',
    opening: id,
    place: p && {
      chapterIndex: p.chapterIndex,
      chapterTitle: p.chapterTitle,
      chapter: p.chapter,
      page: p.page,
      pageHref: p.pageHref,
      label: p.label,
      position: p.position,
    },
    createdAt,
  }
}

describe('momentAnchor', () => {
  const text = 'It was a bright cold day.  And the clocks were striking thirteen, as they do.'

  it('starts at a sentence start, with the text either side', () => {
    const at = text.indexOf('And')
    const anchor = momentAnchor(text, at)
    expect(anchor).toMatchObject({ start: at, exact: text.slice(at, at + 64) })
    const { prefix, suffix } = contextAt(text, at, at + 64)
    expect([anchor?.prefix, anchor?.suffix]).toEqual([prefix, suffix])
  })

  it('skips the spaces after an offset to the next character', () => {
    const anchor = momentAnchor(text, text.indexOf('.') + 1)
    expect(anchor?.start).toBe(text.indexOf('And'))
    expect(anchor?.exact.startsWith('And the clocks')).toBe(true)
  })

  it('takes at most 64 units and never splits a surrogate pair', () => {
    const long = `${'a'.repeat(63)}😀 and more`
    expect(momentAnchor(long, 0)).toMatchObject({ start: 0, end: 63, exact: 'a'.repeat(63) })
    expect(momentAnchor(`${'b'.repeat(62)}😀 more`, 0)?.exact).toBe(`${'b'.repeat(62)}😀`)
    expect(momentAnchor(`x${'c'.repeat(80)}`, 1)?.exact).toBe('c'.repeat(64))
  })

  it('is null past the text, on whitespace only, or for an offset that isn’t a whole number', () => {
    expect(momentAnchor(text, text.length)).toBeNull()
    expect(momentAnchor(text, text.length + 1)).toBeNull()
    expect(momentAnchor('   \n\t ', 0)).toBeNull()
    expect(momentAnchor('Word.   ', 5)).toBeNull()
    expect(momentAnchor(text, -1)).toBeNull()
    expect(momentAnchor(text, 1.5)).toBeNull()
  })
})

describe('inListeningOrder', () => {
  it('sorts read-aloud bookmarks by page and offset, missing ones last and oldest first', () => {
    const list = [
      voice('gone-late', null, '2026-11-05T12:00:00Z'),
      voice('p2-late', [1, 40]),
      voice('gone-early', null, '2026-11-05T09:00:00Z'),
      voice('p1', [0, 300]),
      voice('p2-early', [1, 10]),
    ]
    expect(inListeningOrder(list).map((b) => b.id)).toEqual(['p1', 'p2-early', 'p2-late', 'gone-early', 'gone-late'])
  })

  it('sorts episode bookmarks by episode and time, missing ones last', () => {
    const list: AudioBookmarkView[] = [
      episode('gone', null),
      episode('e2-start', [2, 1000]),
      episode('e1-late', [1, 90_000]),
      episode('e1-early', [1, 12_000]),
    ]
    expect(inListeningOrder(list).map((b) => b.id)).toEqual(['e1-early', 'e1-late', 'e2-start', 'gone'])
  })

  it('breaks a tie by age, then id', () => {
    const a = voice('b', [0, 5], '2026-11-05T11:00:00Z')
    const b = voice('a', [0, 5], '2026-11-05T11:00:00Z')
    const c = voice('c', [0, 5], '2026-11-05T10:00:00Z')
    expect(inListeningOrder([a, b, c]).map((x) => x.id)).toEqual(['c', 'a', 'b'])
  })
})

describe('tabOrder', () => {
  it('puts a page bookmark before the read-aloud bookmarks on its page, and those by offset', () => {
    const entries = tabOrder(
      [pageBookmark('page-2', 1), pageBookmark('page-1', 0)],
      [voice('v2-late', [1, 90]), voice('v2-early', [1, 3]), voice('v1', [0, 500])],
    )
    expect(entries.map((e) => `${e.kind}:${e.bookmark.id}`)).toEqual([
      'page:page-1',
      'voice:v1',
      'page:page-2',
      'voice:v2-early',
      'voice:v2-late',
    ])
  })

  it('lists the missing ones of both kinds last, oldest first, and leaves episode bookmarks out', () => {
    const entries = tabOrder(
      [pageBookmark('page-gone', null, '2026-11-05T12:00:00Z'), pageBookmark('page-1', 0)],
      [voice('voice-gone', null, '2026-11-05T08:00:00Z'), episode('episode', [1, 0])],
    )
    expect(entries.map((e) => e.bookmark.id)).toEqual(['page-1', 'voice-gone', 'page-gone'])
  })
})
