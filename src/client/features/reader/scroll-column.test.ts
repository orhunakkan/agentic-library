import { describe, expect, it } from 'vitest'
import { buildReaderView, type ReaderView } from '~/shared/content/reader-view'
import { chapterFixture, metaFor, pagedFixture } from '../../../../tests/fixtures/books'
import { fixtureCatalog } from '../../../../tests/fixtures/catalog'
import {
  appended,
  type Column,
  columnAt,
  nextHref,
  onRouteChange,
  pageAtLine,
  prepended,
  prevHref,
  readerParams,
} from './scroll-column'

function essay(part: string, n?: string): ReaderView {
  const view = buildReaderView({ meta: metaFor('essays'), catalog: fixtureCatalog }, chapterFixture, part, n)
  if (!view) throw new Error(`${part}/${n}`)
  return view
}
function printed(page: number): ReaderView {
  const view = buildReaderView({ meta: metaFor('confessions'), catalog: fixtureCatalog }, pagedFixture, String(page))
  if (!view) throw new Error(String(page))
  return view
}
const page = (view: ReaderView) => ({ href: view.canonicalPath, view })
const hrefs = (column: Column) => column.pages.map((p) => p.href)

describe('columnAt', () => {
  it('starts a column of one page, in that page’s chapter', () => {
    expect(columnAt(essay('history', '2'))).toEqual({
      chapterIndex: 0,
      pages: [page(essay('history', '2'))],
      loading: null,
      failed: null,
    })
  })
})

describe('nextHref and prevHref', () => {
  it('stay in the chapter', () => {
    const column = columnAt(essay('history', '2'))
    expect(nextHref(column)).toBe('/read/essays/history/3')
    expect(prevHref(column)).toBe('/read/essays/history')
    expect(nextHref(columnAt(printed(9)))).toBe('/read/confessions/10')
  })

  it('are null at the chapter’s edges, even when another chapter follows', () => {
    expect(prevHref(columnAt(essay('history')))).toBeNull()
    expect(nextHref(columnAt(essay('history', '3')))).toBeNull()
    expect(nextHref(columnAt(printed(8)))).toBeNull()
    expect(prevHref(columnAt(printed(9)))).toBeNull()
    expect(nextHref(columnAt(essay('self-reliance')))).toBeNull()
  })

  it('read the column’s last and first pages', () => {
    const column = appended(columnAt(essay('history')), page(essay('history', '2')))
    expect(nextHref(column)).toBe('/read/essays/history/3')
    expect(prevHref(column)).toBeNull()
  })
})

describe('appended and prepended', () => {
  it('add the next page after the last and the previous before the first', () => {
    let column = columnAt(essay('history', '2'))
    column = appended(column, page(essay('history', '3')))
    column = prepended(column, page(essay('history')))
    expect(hrefs(column)).toEqual(['/read/essays/history', '/read/essays/history/2', '/read/essays/history/3'])
  })

  it('clear the loading and failed marks of their own end only', () => {
    const column: Column = { ...columnAt(essay('history', '2')), loading: 'next', failed: 'prev' }
    expect(appended(column, page(essay('history', '3')))).toMatchObject({ loading: null, failed: 'prev' })
    const other: Column = { ...columnAt(essay('history', '2')), loading: 'prev', failed: 'next' }
    expect(prepended(other, page(essay('history')))).toMatchObject({ loading: null, failed: 'next' })
  })

  it('ignore a page that isn’t the next or previous one', () => {
    const column = columnAt(essay('history', '2'))
    expect(appended(column, page(essay('history')))).toBe(column)
    expect(appended(column, page(essay('history', '2')))).toBe(column)
    expect(prepended(column, page(essay('history', '3')))).toBe(column)
    const last = columnAt(essay('history', '3'))
    expect(appended(last, page(essay('self-reliance')))).toBe(last)
  })
})

describe('onRouteChange', () => {
  const column = appended(columnAt(essay('history')), page(essay('history', '2')))

  it('does nothing when the column’s own scroll moved the address', () => {
    expect(onRouteChange(column, essay('history', '2'), true)).toEqual({ kind: 'none' })
  })

  it('scrolls to a page already loaded', () => {
    expect(onRouteChange(column, essay('history', '2'), false)).toEqual({ kind: 'scroll', index: 1 })
    expect(onRouteChange(column, essay('history'), false)).toEqual({ kind: 'scroll', index: 0 })
  })

  it('starts again at an unloaded page of the chapter', () => {
    expect(onRouteChange(column, essay('history', '3'), false)).toEqual({
      kind: 'reset',
      column: columnAt(essay('history', '3')),
    })
  })

  it('starts again in another chapter or book', () => {
    expect(onRouteChange(column, essay('self-reliance'), false)).toEqual({
      kind: 'reset',
      column: columnAt(essay('self-reliance')),
    })
    expect(onRouteChange(columnAt(printed(7)), essay('history'), false).kind).toBe('reset')
  })
})

describe('pageAtLine', () => {
  const tops = [-900, -100, 400]

  it('is the last page whose top is at or above the line', () => {
    expect(pageAtLine(tops, 240, false)).toBe(1)
    expect(pageAtLine([0, 800], 240, false)).toBe(0)
  })

  it('counts a top exactly on the line', () => {
    expect(pageAtLine(tops, 400, false)).toBe(2)
    expect(pageAtLine(tops, 399, false)).toBe(1)
  })

  it('is the first page when every top is below the line', () => {
    expect(pageAtLine([300, 900], 240, false)).toBe(0)
  })

  it('is the last page at the bottom of the document', () => {
    expect(pageAtLine([-1200, -600, 100], 240, true)).toBe(2)
    expect(pageAtLine([-1200, 500, 900], 240, true)).toBe(2)
  })

  it('is 0 for an empty column', () => {
    expect(pageAtLine([], 240, false)).toBe(0)
  })
})

describe('readerParams', () => {
  it('reads chapter, screen-page, printed-page and private-book addresses', () => {
    expect(readerParams('/read/essays/history')).toEqual({ book: 'essays', part: 'history' })
    expect(readerParams('/read/essays/history/3')).toEqual({ book: 'essays', part: 'history', n: '3' })
    expect(readerParams('/read/confessions/112')).toEqual({ book: 'confessions', part: '112' })
    expect(readerParams('/read/u-0f8e2a8c-4c4b-4a3e-9d8c-6f1b2a3c4d5e/chapter-1/2')).toEqual({
      book: 'u-0f8e2a8c-4c4b-4a3e-9d8c-6f1b2a3c4d5e',
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
