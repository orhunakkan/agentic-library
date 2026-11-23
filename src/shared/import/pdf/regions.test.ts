import { describe, expect, it } from 'vitest'
import { ALT_MAX } from '../blocks.ts'
import { CAPTION, clusters, joinProse, type PageItem, pageRegions } from './regions.ts'
import { BODY, BODY_ITALIC, box, HEAD, line, linesOf, MATH, MONO, page, run, runsFrom } from './test-pages.ts'
import { type Box, type PdfLine, type StyleKind, styleKey } from './types.ts'

const BODY_STYLE = { style: styleKey(BODY, 10), size: 10 }
const KINDS: ReadonlyMap<string, StyleKind> = new Map([
  [styleKey(BODY, 10), 'body'],
  [styleKey(BODY, 9), 'body'],
  [styleKey(BODY_ITALIC, 9), 'body'],
  [styleKey(MONO, 8.5), 'code'],
  [styleKey(HEAD, 7.5), 'body'],
])
const PROSE = 'river stone lantern harbour meadow orchard compass journey quiet morning letter garden window'

const prose = (count: number, y: number, x = 45) =>
  Array.from({ length: count }, (_, i) => line(PROSE, { x, y: y + i * 14 }))

const texts = (items: readonly PageItem[]) => items.map((it) => ('line' in it ? it.line.text : `[${it.region.key}]`))

function regionsOf(lines: PdfLine[], options: { images?: Box[]; paths?: Box[] } = {}) {
  return pageRegions(page(3, [], options), lines, KINDS, BODY_STYLE)
}

describe('pictures and drawings', () => {
  it('crops an embedded image and places it among the lines where it sits', () => {
    const lines = [...prose(2, 80), ...prose(2, 300)]
    const { regions, items } = regionsOf(lines, { images: [box(120, 120, 180, 120), box(60, 260, 12, 12)] })
    expect(regions).toEqual([
      {
        page: 3,
        n: 1,
        key: 'pdf:3:1',
        box: box(120, 120, 180, 120),
        kind: 'image',
        alt: 'Figure from page 3',
        caption: null,
      },
    ])
    expect(texts(items)).toEqual([PROSE, PROSE, '[pdf:3:1]', PROSE, PROSE])
  })

  it('merges path boxes within 6pt into one drawing', () => {
    expect(clusters([box(0, 0, 100, 30), box(0, 34, 100, 30), box(200, 0, 10, 10)])).toHaveLength(2)
    const { regions } = regionsOf(prose(1, 300), { paths: [box(100, 100, 100, 30), box(100, 134, 100, 30)] })
    expect(regions.map((r) => [r.kind, r.box])).toEqual([['figure', box(100, 100, 100, 64)]])
  })

  it('never takes a thin rule, a small drawing or the page background for a figure', () => {
    const { regions, items } = regionsOf(prose(3, 80), {
      paths: [box(45, 200, 99, 0.75), box(45, 300, 300, 1), box(200, 400, 40, 40), box(0, 0, 420, 595)],
    })
    expect(regions).toEqual([])
    expect(items).toHaveLength(3)
  })

  it('reads the code on a shaded box as text, not a picture', () => {
    const code = ['function trim(wick) {', '  return wick', '}'].map((t, i) =>
      line(t, { x: 55, y: 221 + i * 11, size: 8.5, font: MONO }),
    )
    const { regions, items } = regionsOf([...prose(2, 180), ...code], { paths: [box(45, 205, 330, 83)] })
    expect(regions).toEqual([])
    expect(items).toHaveLength(5)
  })

  it('reads a sidebar of prose on a shaded box as text', () => {
    const { regions } = regionsOf(prose(5, 120, 60), { paths: [box(45, 100, 330, 90)] })
    expect(regions).toEqual([])
  })

  it('crops a ruled table, with its cells as the alt and the caption below it', () => {
    const rows = [310, 331, 352, 373]
    const borders = [
      ...[300, 321, 342, 363, 384].map((y) => box(100, y, 175, 0.75)),
      ...[100, 150, 210, 275].map((x) => box(x, 300, 0.75, 84)),
    ]
    const cells = rows.flatMap((y, r) =>
      (r === 0 ? ['Date', 'Weather', 'Hours lit'] : [`${r + 2} May`, 'Fog', '11']).map((t, c) =>
        line(t, { x: 110 + c * 60, y, size: 9 }),
      ),
    )
    const caption = line('Table 3.1 Three days of the keeper’s log.', { x: 132, y: 396, size: 9, font: BODY_ITALIC })
    const { regions, items } = regionsOf([...prose(2, 260), ...cells, caption, ...prose(2, 430)], { paths: borders })
    expect(regions).toHaveLength(1)
    expect(regions[0]?.kind).toBe('figure')
    expect(regions[0]?.alt).toBe('Date Weather Hours lit 3 May Fog 11 4 May Fog 11 5 May Fog 11')
    expect(regions[0]?.caption).toBe('Table 3.1 Three days of the keeper’s log.')
    expect(texts(items)).toEqual([PROSE, PROSE, '[pdf:3:1]', PROSE, PROSE])
  })

  it('crops a diagram with its labels as the alt', () => {
    const labels = ['Lamp', 'Lens', 'Ship'].map((t, i) => line(t, { x: 70 + i * 64, y: 300, size: 7.5, font: HEAD }))
    const shapes = [box(48, 280, 45, 33), box(112, 280, 45, 33), box(176, 280, 45, 33), box(93, 295, 19, 1.5)]
    const frame = box(48, 262, 180, 68)
    const { regions } = regionsOf([...prose(1, 240), ...labels], { paths: [...shapes, frame] })
    expect(regions.map((r) => r.alt)).toEqual(['Lamp Lens Ship'])
  })

  it('takes in a chart’s title just outside its paths, but not body text beside it', () => {
    const title = line('Nights lit per harbour', { x: 110, y: 66, size: 6.75, font: HEAD })
    const bars = [box(60, 70, 285, 1), box(60, 70, 1, 68), box(90, 100, 30, 38), box(160, 80, 30, 58)]
    const { regions, items } = regionsOf([title, ...prose(1, 150)], { paths: bars })
    expect(regions.map((r) => r.alt)).toEqual(['Nights lit per harbour'])
    expect(regions[0]?.box.y).toBeLessThan(66 - 6.75 + 0.1)
    expect(texts(items)).toEqual(['[pdf:3:1]', PROSE])
  })

  it('joins a shaded box behind an image to the image', () => {
    const { regions } = regionsOf([], { images: [box(100, 100, 100, 100)], paths: [box(96, 96, 108, 104)] })
    expect(regions).toHaveLength(1)
    expect(regions[0]?.box).toEqual(box(96, 96, 108, 104))
  })

  it('caps a long alt', () => {
    const inside = Array.from({ length: 40 }, (_, i) => line(PROSE.repeat(3), { x: 50, y: 110 + i * 10, size: 4 }))
    const { regions } = regionsOf(inside, { images: [box(45, 100, 330, 420)] })
    expect(regions[0]?.alt.length).toBe(ALT_MAX)
  })
})

describe('captions', () => {
  it('finds a caption above the region, through the end of its paragraph', () => {
    const caption = [
      line('Figure 2.1 How a signal travels from the lamp to a ship far out at sea, and', { x: 60, y: 200, size: 9 }),
      line('back.', { x: 60, y: 212, size: 9 }),
    ]
    const { regions, items } = regionsOf([...prose(1, 170), ...caption, ...prose(2, 360)], {
      images: [box(60, 220, 200, 100)],
    })
    expect(regions[0]?.caption).toBe(
      'Figure 2.1 How a signal travels from the lamp to a ship far out at sea, and back.',
    )
    expect(texts(items)).toEqual([PROSE, '[pdf:3:1]', PROSE, PROSE])
  })

  it('looks only two lines away, and leaves a line that only mentions a figure alone', () => {
    const near = [line('see figure 4 for this', { y: 330 }), ...prose(2, 344)]
    const far = [...prose(2, 330), line('Figure 9 is too far away', { y: 358 })]
    expect(regionsOf(near, { images: [box(45, 200, 200, 100)] }).regions[0]?.caption).toBeNull()
    expect(regionsOf(far, { images: [box(45, 200, 200, 100)] }).regions[0]?.caption).toBeNull()
  })

  it('matches the caption words, a hyphen joined before a lowercase letter', () => {
    expect(
      ['Figure 1.1', 'Fig. 3', 'TABLE A', 'Listing 2', 'Plate IV', 'Exhibit 7'].every((t) => CAPTION.test(t)),
    ).toBe(true)
    expect(['Figures show that', 'Table salt', 'Figure shows'].some((t) => CAPTION.test(t))).toBe(false)
    expect(joinProse(['A trans-', 'formation and a well-', 'Known', ' '])).toBe('A transformation and a well- Known')
  })
})

describe('display equations', () => {
  const maths = (y: number) =>
    linesOf(
      runsFrom(127, [
        ['f(x) = a·x', { font: MATH }],
        ['+ b·y − c', { font: MATH }],
      ]),
      { y },
    )

  it('crops a centred line set in maths fonts, apart from the text', () => {
    const lines = [...prose(3, 260), maths(309), ...prose(3, 333)]
    const { regions, items } = regionsOf(lines)
    expect(regions.map((r) => [r.kind, r.alt, r.caption])).toEqual([['equation', 'f(x) = a·x + b·y − c', null]])
    expect(texts(items)).toEqual([PROSE, PROSE, PROSE, '[pdf:3:1]', PROSE, PROSE, PROSE])
  })

  it('leaves inline maths in a body line as text', () => {
    const inline = linesOf(
      [run('where', { x: 45 }), run('x', { x: 80, font: MATH }), run('is the count of nights', { x: 90 })],
      {
        y: 274,
      },
    )
    const tight = [...prose(2, 246), maths(274), ...prose(2, 288)]
    expect(regionsOf([...prose(2, 246), inline, ...prose(2, 288)]).regions).toEqual([])
    expect(regionsOf(tight).regions).toEqual([])
  })

  it('crops an indented display line, and one at the top of the page', () => {
    const indented = linesOf([run('x + y = z', { x: 90, font: MATH, width: 300 })], { y: 300 })
    expect(regionsOf([...prose(2, 260), indented, ...prose(2, 330)]).regions).toHaveLength(1)
    expect(regionsOf([maths(60)]).regions).toHaveLength(1)
  })
})

describe('numbering', () => {
  it('numbers regions down the page and keys them by page', () => {
    const { regions, items } = regionsOf(prose(1, 500), {
      images: [box(45, 300, 100, 100), box(45, 60, 100, 100)],
    })
    expect(regions.map((r) => [r.key, r.box.y])).toEqual([
      ['pdf:3:1', 60],
      ['pdf:3:2', 300],
    ])
    expect(texts(items)).toEqual(['[pdf:3:1]', '[pdf:3:2]', PROSE])
  })

  it('places a region after the last line above it when no line follows', () => {
    const { items } = regionsOf([...prose(2, 80), line('aside', { x: 300, y: 400 })], {
      images: [box(45, 200, 100, 100)],
    })
    expect(texts(items)).toEqual([PROSE, PROSE, '[pdf:3:1]', 'aside'])
    expect(texts(regionsOf([line('aside', { x: 300, y: 400 })], { images: [box(45, 200, 100, 100)] }).items)).toEqual([
      'aside',
      '[pdf:3:1]',
    ])
  })
})
