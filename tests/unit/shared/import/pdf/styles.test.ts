import { describe, expect, it } from 'vitest'
import {
  bodyLineGap,
  bodyStyle,
  chapterWordsBy,
  SHOWN_MAX,
  shownStyles,
  styleKinds,
  styleTable,
} from '~/shared/import/pdf/styles.ts'
import { type PdfLine, type PdfStyle, styleKey } from '~/shared/import/pdf/types.ts'
import {
  BODY,
  BODY_BOLD,
  BODY_ITALIC,
  HEAD,
  line,
  linesOf,
  MONO,
  run,
  runsFrom,
} from '../../../../support/shared/pdf/test-pages.ts'

const TEN_WORDS = 'river stone lantern harbour meadow orchard compass journey quiet morning'

type Spec = string | { text: string; size?: number; font?: string; gap?: number }

function pageOf(specs: readonly Spec[], page = 1): PdfLine[] {
  let y = 46
  return specs.map((spec) => {
    const { text, size = 10, font = BODY, gap = 14 } = typeof spec === 'string' ? { text: spec } : spec
    y += gap
    return line(text, { page, y, size, font })
  })
}

const body = (count: number) => Array.from({ length: count }, () => TEN_WORDS)

function book(chapterLines = 12): PdfLine[][] {
  return ['One', 'Two', 'Three'].map((name, i) =>
    pageOf(
      [
        { text: `Chapter ${name}`, size: 20, font: HEAD },
        ...body(chapterLines),
        { text: `Section of ${name}`, size: 14, font: HEAD, gap: 24 },
        ...body(2),
        { text: 'const answer = 42', size: 8.5, font: MONO, gap: 20 },
      ],
      i + 1,
    ),
  )
}

const guessOf = (styles: readonly PdfStyle[], font: string, size: number) =>
  styles.find((s) => s.key === styleKey(font, size))?.guess

describe('bodyStyle', () => {
  it('is the style with the most characters, superscripts aside', () => {
    const pages = [
      [
        line('Short title', { font: HEAD, size: 20 }),
        linesOf(runsFrom(45, [TEN_WORDS, ['1', { sup: true, size: 7 }]])),
        line(TEN_WORDS),
      ],
    ]
    expect(bodyStyle(pages)).toEqual({ style: styleKey(BODY, 10), size: 10 })
  })

  it('falls back to 10pt without a style when there is no text', () => {
    expect(bodyStyle([[]])).toEqual({ style: '', size: 10 })
  })

  it('rounds the size to half a point', () => {
    expect(bodyStyle([[line(TEN_WORDS, { size: 9.49 })]]).size).toBe(9.5)
  })
})

describe('styleTable', () => {
  it('ranks heading sizes into chapter titles and sections, and sees code by its mono font', () => {
    const pages = book()
    const styles = styleTable(pages, bodyStyle(pages))
    expect(guessOf(styles, BODY, 10)).toBe('body')
    expect(guessOf(styles, HEAD, 20)).toBe('chapter')
    expect(guessOf(styles, HEAD, 14)).toBe('h3')
    expect(guessOf(styles, MONO, 8.5)).toBe('code')
    expect(styles[0]?.key).toBe(styleKey(BODY, 10))
    expect(styles.map((s) => s.chars)).toEqual([...styles.map((s) => s.chars)].sort((a, b) => b - a))
  })

  it('makes a third heading level h4, and a fourth h4 too', () => {
    const pages = book().map((lines, i) => [
      ...lines,
      line('Sub one', { page: i + 1, y: 400, font: HEAD, size: 12 }),
      line('Sub two', { page: i + 1, y: 430, font: HEAD, size: 11 }),
    ])
    const styles = styleTable(pages, bodyStyle(pages))
    expect(guessOf(styles, HEAD, 12)).toBe('h4')
    expect(guessOf(styles, HEAD, 11)).toBe('h4')
  })

  it('takes the next size down for chapters when the largest makes too few, and keeps the larger as a heading', () => {
    const pages = book()
    pages[0]?.unshift(line('A Title Over Everything', { y: 30, font: HEAD, size: 28 }))
    const styles = styleTable(pages, bodyStyle(pages))
    expect(guessOf(styles, HEAD, 28)).toBe('h3')
    expect(guessOf(styles, HEAD, 20)).toBe('chapter')
    expect(guessOf(styles, HEAD, 14)).toBe('h3')
  })

  it('makes no chapter style when no heading size gives chapters of a hundred words', () => {
    const pages = book(3)
    const styles = styleTable(pages, bodyStyle(pages))
    expect(guessOf(styles, HEAD, 20)).toBe('h3')
    expect(guessOf(styles, HEAD, 14)).toBe('h4')
    expect(styles.some((s) => s.guess === 'chapter')).toBe(false)
  })

  it('counts a title wrapped onto two lines as one heading', () => {
    const pages = book()
    pages[1]?.splice(1, 0, line('continued', { page: 2, y: 61, font: HEAD, size: 20 }))
    expect(chapterWordsBy(styleKey(HEAD, 20), pages)).toHaveLength(3)
  })

  it('reads bold at body size alone on a line after a gap as a heading, and bold inside a line as body', () => {
    const run_in = (page: number) =>
      pageOf(
        [
          ...body(4),
          { text: 'A bold heading', font: BODY_BOLD, gap: 26 },
          ...body(8),
          linesOf(runsFrom(45, ['some', ['bold', { font: BODY_BOLD }], 'words'])).text,
        ],
        page,
      )
    const pages = [1, 2, 3].map(run_in)
    expect(guessOf(styleTable(pages, bodyStyle(pages)), BODY_BOLD, 10)).toBe('chapter')

    const inline = [
      [
        line(TEN_WORDS, { y: 60 }),
        linesOf(runsFrom(45, ['some', ['bold', { font: BODY_BOLD }], 'words', TEN_WORDS]), { y: 74 }),
        line(TEN_WORDS, { y: 88 }),
      ],
    ]
    expect(guessOf(styleTable(inline, bodyStyle(inline)), BODY_BOLD, 10)).toBe('body')
  })

  it('keeps an italic style as body, strips a subset prefix and samples the first 60 characters', () => {
    const pages = [
      [
        line(TEN_WORDS, { y: 60 }),
        line('An   italic   aside that is quite long and goes on beyond sixty characters', {
          y: 74,
          font: `ABCDEF+${BODY_ITALIC}`,
        }),
      ],
    ]
    const italic = styleTable(pages, bodyStyle(pages)).find((s) => s.font === BODY_ITALIC)
    expect(italic?.guess).toBe('body')
    expect(italic?.sample).toBe('An italic aside that is quite long and goes on beyond sixty ')
    expect(italic?.sample).toHaveLength(60)
  })

  it('leaves out superscripts and lines with no style of their own as headings', () => {
    const pages = [
      [
        linesOf([run(TEN_WORDS), run('9', { x: 300, sup: true, size: 14 })], { y: 60 }),
        linesOf(runsFrom(45, [['B', { font: HEAD, size: 16 }], TEN_WORDS]), { y: 74 }),
      ],
    ]
    const styles = styleTable(pages, bodyStyle(pages))
    expect(styles.some((s) => s.size === 14)).toBe(false)
    expect(guessOf(styles, HEAD, 16)).toBe('body')
  })
})

describe('bodyLineGap', () => {
  it('is the median gap between consecutive body lines, or 1.2× the size without any', () => {
    const pages = [pageOf([...body(3), { text: TEN_WORDS, gap: 30 }])]
    expect(bodyLineGap(pages, bodyStyle(pages))).toBe(14)
    expect(bodyLineGap([[]], { style: '', size: 10 })).toBe(12)
  })
})

describe('shownStyles', () => {
  const style = (key: string, chars: number): PdfStyle => ({
    key,
    font: key,
    size: 10,
    chars,
    sample: '',
    guess: 'body',
  })

  it('keeps styles with at least 0.5% of the characters, ten at most, most first', () => {
    const styles = [
      style('rare', 4),
      style('main', 1000),
      ...Array.from({ length: 12 }, (_, i) => style(`s${i}`, 50 + i)),
    ]
    const shown = shownStyles(styles)
    expect(shown).toHaveLength(SHOWN_MAX)
    expect(shown[0]?.key).toBe('main')
    expect(shown.some((s) => s.key === 'rare')).toBe(false)
    expect(shownStyles([])).toEqual([])
  })

  it('lists heading and code styles however few characters they hold', () => {
    const shown = shownStyles([style('main', 10_000), { ...style('title', 40), guess: 'chapter' }, style('rare', 4)])
    expect(shown.map((s) => s.key)).toEqual(['main', 'title'])
  })
})

describe('styleKinds', () => {
  it('is each guess, an override winning, and unknown keys or kinds ignored', () => {
    const pages = book()
    const styles = styleTable(pages, bodyStyle(pages))
    const chapter = styleKey(HEAD, 20)
    const kinds = styleKinds(styles, {
      [chapter]: 'body',
      nowhere: 'chapter',
      [styleKey(HEAD, 14)]: 'nonsense' as 'body',
    })
    expect(kinds.get(chapter)).toBe('body')
    expect(kinds.get(styleKey(HEAD, 14))).toBe('h3')
    expect(kinds.has('nowhere')).toBe(false)
    expect(styleKinds(styles).get(chapter)).toBe('chapter')
  })
})
