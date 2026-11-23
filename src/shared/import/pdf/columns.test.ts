import { describe, expect, it } from 'vitest'
import { readingOrder } from './columns.ts'
import { pageLines } from './lines.ts'
import { BODY, BODY_SIZE, bodyLines, filler, page, text, twoColumnPage } from './test-pages.ts'
import { type PdfPage, styleKey } from './types.ts'

const BODY_STYLE = { style: styleKey(BODY, BODY_SIZE), size: BODY_SIZE }
const order = (p: PdfPage) => readingOrder(pageLines(p), BODY_STYLE)

describe('readingOrder', () => {
  it('reads a two-column page left column first, then right', () => {
    const { lines, columns } = order(twoColumnPage(1, filler(20, 'left'), filler(20, 'right')))
    expect(columns).toBe(2)
    expect(lines.map((l) => l.text)).toEqual([...filler(20, 'left'), ...filler(20, 'right')])
  })

  it('puts a full-width title and authors above the columns first, and a full-width line below them last', () => {
    const p = twoColumnPage(1, filler(20, 'left'), filler(20, 'right'), {
      title: 'Lanterns at Sea: A Short Study of Harbour Lights',
    })
    p.items.push(text('Ada Tester and Lin Tester and Grace Tester', { x: 200, y: 105 }))
    p.items.push(text('A closing line in the body style that runs across both columns.', { x: 54, y: 420, width: 487 }))
    const { lines, columns } = order(p)
    expect(columns).toBe(2)
    expect(lines.map((l) => l.text)).toEqual([
      'Lanterns at Sea: A Short Study of Harbour Lights',
      'Ada Tester and Lin Tester and Grace Tester',
      ...filler(20, 'left'),
      ...filler(20, 'right'),
      'A closing line in the body style that runs across both columns.',
    ])
  })

  it('reads a footnote at the foot of a page after both short columns', () => {
    const p = twoColumnPage(1, filler(15, 'left'), filler(15, 'right'))
    p.items.push(text('1 Four harbours on the north coast.', { x: 54, y: 772, size: 7.5 }))
    const { lines, columns } = order(p)
    expect(columns).toBe(2)
    expect(lines.map((l) => l.text)).toEqual([
      ...filler(15, 'left'),
      ...filler(15, 'right'),
      '1 Four harbours on the north coast.',
    ])
  })

  it('does not split a single-column page with an indented quotation', () => {
    const items = [
      ...bodyLines(['A paragraph of body text that runs the full width of the page.'.repeat(1)], { y: 100 }),
      ...bodyLines(filler(6, 'quoted'), { x: 90, y: 128 }),
      ...bodyLines(filler(8, 'after'), { y: 230 }),
    ]
    const { lines, columns } = order(page(1, items))
    expect(columns).toBe(1)
    expect(lines.map((l) => l.text)).toEqual([
      'A paragraph of body text that runs the full width of the page.',
      ...filler(6, 'quoted'),
      ...filler(8, 'after'),
    ])
  })

  it('does not take a gap crossed by a body line halfway down for a gutter', () => {
    const p = twoColumnPage(1, filler(10, 'left'), filler(10, 'right'))
    p.items.push(
      text('A full-width body line in the middle of the page, across the gap.', { x: 54, y: 206, width: 487 }),
    )
    const below = twoColumnPage(1, filler(10, 'lower'), filler(10, 'later')).items.map((i) => ({ ...i, y: i.y + 140 }))
    p.items.push(...below)
    const { lines, columns } = order(p)
    expect(columns).toBe(1)
    expect(lines[0]?.text).toBe(filler(10, 'left')[0])
    expect(lines[1]?.text).toBe(filler(10, 'right')[0])
  })

  it('keeps justified words one line in each column, the columns apart', () => {
    const size = 9.5
    const words = (x: number, y: number, prefix: string) => {
      const items = []
      let left = x
      for (let i = 0; i < 6; i++) {
        const item = text(`${prefix}${i}`, { x: left, y, size, width: 30 })
        items.push(item)
        left += 30 + size * 1.1
      }
      return items
    }
    const items = Array.from({ length: 12 }, (_, row) => [
      ...words(54, 100 + row * 12, `l${row}w`),
      ...words(310, 100 + row * 12, `r${row}w`),
    ]).flat()
    const { lines, columns } = readingOrder(pageLines(page(1, items, { width: 595, height: 842 })), {
      style: styleKey(BODY, size),
      size,
    })
    expect(columns).toBe(2)
    expect(lines).toHaveLength(24)
    expect(lines[0]?.text).toBe('l0w0 l0w1 l0w2 l0w3 l0w4 l0w5')
    expect(lines[11]?.text).toMatch(/^l11w0/)
    expect(lines[12]?.text).toBe('r0w0 r0w1 r0w2 r0w3 r0w4 r0w5')
  })

  it('reads a page without body text, or without lines, as one column', () => {
    expect(readingOrder([], BODY_STYLE)).toEqual({ lines: [], columns: 1 })
    const headings = pageLines(page(1, [text('Only', { size: 20, font: 'Sans-Bold' })]))
    expect(readingOrder(headings, BODY_STYLE).columns).toBe(1)
  })
})
