import { describe, expect, it } from 'vitest'
import { pageLines, removeFurniture } from '~/shared/import/pdf/lines.ts'
import { styleKey } from '~/shared/import/pdf/types.ts'
import {
  BODY,
  BODY_ITALIC,
  HEAD,
  MARGIN,
  PAGE_HEIGHT,
  page,
  text,
  textLine,
} from '../../../../support/shared/pdf/test-pages.ts'

const one = (items: Parameters<typeof page>[1]) => pageLines(page(1, items))

describe('pageLines', () => {
  it('joins the items of a baseline, with a space where they are apart and none inside a split word', () => {
    const items = [
      text('A keeper learns', { x: 45, width: 74 }),
      text('patience', { x: 121.2, width: 36.7, font: BODY_ITALIC }),
      text('trans', { x: 160.3, width: 24 }),
      text('formation', { x: 184.3, width: 40 }),
    ]
    const [line] = one(items)
    expect(line?.text).toBe('A keeper learns patience transformation')
    expect(line?.runs.map((r) => r.text)).toEqual(['A keeper learns ', 'patience ', 'trans', 'formation'])
    expect(line?.runs[1]?.italic).toBe(true)
  })

  it('keeps an item’s own spaces without adding another', () => {
    const [line] = one([text('word ', { x: 45, width: 25 }), text('next', { x: 72, width: 20 })])
    expect(line?.text).toBe('word next')
  })

  it('treats baselines 0.2× the size apart as one line and 0.5× apart as two', () => {
    expect(one([text('left', { x: 45, y: 100 }), text('right', { x: 70, y: 102 })])).toHaveLength(1)
    expect(one([text('left', { x: 45, y: 100 }), text('right', { x: 70, y: 105 })])).toHaveLength(2)
  })

  it('keeps justified word spaces in one line and splits at a gutter or between table cells', () => {
    const left = textLine(['bridge', 'harbour', 'letter'], 54, 237).map((t, i) => ({ ...t, x: t.x + i * 8 }))
    const right = textLine(['garden', 'stone'], 310, 237)
    const lines = one([...left, ...right])
    expect(lines.map((l) => l.text)).toEqual(['bridge harbour letter', 'garden stone'])
    expect(lines[1]?.x).toBe(310)
  })

  it('makes a small raised item a superscript of the line below it', () => {
    const items = [
      text('kept a diary of every night.', { x: 45, y: 365.6, width: 140 }),
      text('1', { x: 185, y: 361.5, size: 8.33, width: 4.4 }),
      text('compass bridge', { x: 192, y: 365.6, width: 70 }),
    ]
    const lines = one(items)
    expect(lines).toHaveLength(1)
    const [line] = lines
    expect(line?.runs.map((r) => [r.text, r.sup])).toEqual([
      ['kept a diary of every night.', false],
      ['1 ', true],
      ['compass bridge', false],
    ])
    expect(line?.y).toBe(365.6)
    expect(line?.size).toBe(10)
    expect(line?.style).toBe(styleKey(BODY, 10))
  })

  it('finds a superscript raised by less than the tolerance', () => {
    const [line] = one([text('x', { x: 45, y: 100 }), text('2', { x: 50.5, y: 97.4, size: 7 })])
    expect(line?.runs.map((r) => r.sup)).toEqual([false, true])
  })

  it('leaves a small line that is not raised onto another as a line of its own', () => {
    const lines = one([text('body', { y: 100 }), text('a note', { y: 130, size: 8 })])
    expect(lines.map((l) => [l.text, l.runs[0]?.sup])).toEqual([
      ['body', false],
      ['a note', false],
    ])
  })

  it('sets turned text and empty items aside', () => {
    const lines = one([text('upright'), text('sideways', { y: 200, rotated: true }), text('  ', { y: 300 })])
    expect(lines.map((l) => l.text)).toEqual(['upright'])
  })

  it('names a line by the style with the most characters, and orders lines top to bottom then left to right', () => {
    const lines = one([
      text('b', { x: 200, y: 50 }),
      text('Heading', { x: 45, y: 80, size: 20, font: HEAD }),
      text('a', { x: 45, y: 50 }),
      text('mostly italic words', { x: 45, y: 120, font: BODY_ITALIC }),
      text('and', { x: 150, y: 120 }),
    ])
    expect(lines.map((l) => l.text)).toEqual(['a', 'b', 'Heading', 'mostly italic words and'])
    expect(lines[2]?.style).toBe(styleKey(HEAD, 20))
    expect(lines[3]?.style).toBe(styleKey(BODY_ITALIC, 10))
    expect(lines[3]?.width).toBeCloseTo(150 + 15 - 45)
  })

  it('returns nothing for an empty page', () => {
    expect(one([])).toEqual([])
  })
})

describe('removeFurniture', () => {
  const pages = (count: number) => Array.from({ length: count }, () => ({ height: PAGE_HEIGHT }))
  const bodyOn = (n: number) => text(`Body text of page ${n}.`, { y: 300 })

  function book(extra: (n: number) => ReturnType<typeof text>[]) {
    return Array.from({ length: 10 }, (_, i) => pageLines(page(i + 1, [bodyOn(i + 1), ...extra(i + 1)])))
  }

  it('drops a running header repeated on 3 of 10 pages, numbers aside, and keeps one on 2 of 10', () => {
    const header = (n: number) => text(`Chapter 3 · ${40 + n}`, { x: 180, y: 28, size: 8, font: BODY_ITALIC })
    const three = removeFurniture(
      book((n) => (n <= 3 ? [header(n)] : [])),
      pages(10),
    )
    expect(three.pages.flat().map((l) => l.text)).not.toContain('Chapter 3 · 41')
    expect(three.furniturePages).toBe(3)
    const two = removeFurniture(
      book((n) => (n <= 2 ? [header(n)] : [])),
      pages(10),
    )
    expect(two.pages[0]?.map((l) => l.text)).toContain('Chapter 3 · 41')
    expect(two.furniturePages).toBe(0)
  })

  it('needs a header to repeat on a fifth of the pages as well as on 3', () => {
    const lines = Array.from({ length: 20 }, (_, i) =>
      pageLines(page(i + 1, [bodyOn(i + 1), ...(i < 3 ? [text('Running head', { y: 30 })] : [])])),
    )
    expect(removeFurniture(lines, pages(20)).furniturePages).toBe(0)
  })

  it('drops bare page numbers at the top or bottom of a page', () => {
    const numbers = ['12', 'xii', 'XII', '— 12 —', '- 3 -']
    const lines = numbers.map((n, i) =>
      pageLines(page(i + 1, [bodyOn(i + 1), text(n, { x: 207, y: i % 2 ? 572 : 25, size: 8 })])),
    )
    const result = removeFurniture(lines, pages(numbers.length))
    expect(result.pages.map((p) => p.map((l) => l.text))).toEqual(
      numbers.map((_, i) => [`Body text of page ${i + 1}.`]),
    )
    expect(result.furniturePages).toBe(numbers.length)
  })

  it('keeps a line in the band that does not repeat, and numbers in the body', () => {
    const lines = [
      pageLines(
        page(1, [
          text('A title near the top', { y: 40, size: 14, font: HEAD }),
          text('1.', { x: MARGIN, y: 300 }),
          text('11', { x: 260, y: 330, size: 9 }),
        ]),
      ),
    ]
    const result = removeFurniture(lines, pages(1))
    expect(result.pages[0]?.map((l) => l.text)).toEqual(['A title near the top', '1.', '11'])
    expect(result.furniturePages).toBe(0)
  })
})
