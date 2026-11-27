import { describe, expect, it } from 'vitest'
import type { BookBlock, DraftChapter, ListBlock, Run } from '~/shared/import/blocks.ts'
import { FRONT_MATTER, layoutPdf, NOTES } from '~/shared/import/pdf/layout.ts'
import type { PdfOutlineEntry, PdfPage, PdfText } from '~/shared/import/pdf/types.ts'
import {
  BODY,
  BODY_ITALIC,
  bodyLines,
  box,
  codeLine,
  filler,
  HEAD,
  heading,
  LEADING,
  MARGIN,
  MONO,
  page,
  text,
  textLine,
  twoColumnPage,
} from '../../../../support/shared/pdf/test-pages.ts'

const runsText = (runs: readonly Run[]) => runs.map((r) => ('text' in r ? r.text : '\n')).join('')
const paragraphs = (chapter: DraftChapter | undefined) =>
  (chapter?.blocks ?? []).flatMap((b) => (b.type === 'paragraph' ? [runsText(b.runs)] : []))
const blockTypes = (chapter: DraftChapter | undefined) => (chapter?.blocks ?? []).map((b) => b.type)

function chapterPage(number: number, title: string, count = 16, word = 'harbour'): PdfPage {
  return page(number, [heading(title, 70), ...bodyLines(filler(count, word), { y: 100 })])
}

describe('paragraphs', () => {
  const layout = (items: PdfText[]) => layoutPdf([page(1, items)], [], {}, 'Notes on lamps').chapters

  it('starts a new paragraph after a wide gap, at an indented first line and after a short line ending a sentence', () => {
    const items = [
      ...bodyLines(['one two three four five six seven eight nine ten eleven twelve', 'continued here on the line'], {
        y: 100,
      }),
      ...bodyLines(['after a gap the second paragraph runs on and on for a whole line'], { y: 100 + 3 * LEADING }),
      ...bodyLines(['a short line ends here.'], { y: 100 + 4 * LEADING }),
      ...bodyLines(['and the next line starts the third paragraph, which is long'], { y: 100 + 5 * LEADING }),
      text('an indented first line starts the fourth paragraph here', { x: MARGIN + 12, y: 100 + 6 * LEADING }),
      ...bodyLines(['and runs on to the margin with more words of text in it'], { y: 100 + 7 * LEADING }),
    ]
    const [chapter] = layout(items)
    expect(paragraphs(chapter)).toEqual([
      'one two three four five six seven eight nine ten eleven twelve continued here on the line',
      'after a gap the second paragraph runs on and on for a whole line a short line ends here.',
      'and the next line starts the third paragraph, which is long',
      'an indented first line starts the fourth paragraph here and runs on to the margin with more words of text in it',
    ])
  })

  it('joins a hyphenated word across a line break only before a lowercase letter', () => {
    const items = bodyLines([
      'the work of a long and patient trans-',
      'formation takes years, said the well-known Anglo-',
      'Saxon keeper to the harbour master at dawn',
    ])
    expect(paragraphs(layout(items)[0])).toEqual([
      'the work of a long and patient transformation takes years, said the well-known Anglo- Saxon keeper to the harbour master at dawn',
    ])
  })

  it('keeps italic, bold and inline code as runs', () => {
    const items = [
      ...textLine(
        ['A keeper learns', ['patience', { font: BODY_ITALIC }], 'and calls', ['light()', { font: MONO }]],
        MARGIN,
        100,
      ),
      ...bodyLines(filler(3), { y: 100 + LEADING }),
    ]
    const [chapter] = layout(items)
    const runs = chapter?.blocks[0]?.type === 'paragraph' ? chapter.blocks[0].runs : []
    expect(runs.slice(0, 4)).toEqual([
      { text: 'A keeper learns ' },
      { text: 'patience', style: 'em' },
      { text: ' and calls ' },
      { text: 'light()', style: 'code' },
    ])
  })

  it('leaves a run in another plain font as plain text', () => {
    const items = [
      ...textLine(['The keeper wrote', ['Harbour', { font: 'Sans-Regular' }], 'on the door'], MARGIN, 100),
      ...bodyLines(filler(3), { y: 100 + LEADING }),
    ]
    const [chapter] = layout(items)
    const runs = chapter?.blocks[0]?.type === 'paragraph' ? chapter.blocks[0].runs : []
    expect(runs[0]).toEqual({ text: expect.stringMatching(/^The keeper wrote Harbour on the door /) })
  })
})

describe('code', () => {
  it('keeps a listing’s line breaks, its indent and a blank line', () => {
    const items = [
      ...bodyLines(filler(3), { y: 80 }),
      codeLine('function trim(wick) {', 140),
      codeLine('return wick', 151, MARGIN + 10 + 2 * 5.1),
      codeLine('}', 173),
      ...bodyLines(filler(3), { y: 200 }),
    ]
    const [chapter] = layoutPdf([page(1, items)], []).chapters
    expect(blockTypes(chapter)).toEqual(['paragraph', 'code', 'paragraph'])
    expect(chapter?.blocks[1]).toEqual({ type: 'code', text: 'function trim(wick) {\n  return wick\n\n}' })
  })

  it('reads a listing that runs across 2,000 pages of 80 lines', () => {
    const pages = Array.from({ length: 2000 }, (_, p) =>
      page(p + 1, [
        ...(p === 0 ? bodyLines(filler(3), { y: 40 }) : []),
        ...Array.from({ length: 80 }, (_, i) => codeLine(`line_${p}_${i}()`, 90 + i * 5.5)),
      ]),
    )
    const code = layoutPdf(pages, []).chapters.flatMap((c) => c.blocks.filter((b) => b.type === 'code'))
    expect(code).toHaveLength(1)
    expect(code[0]?.type === 'code' && code[0].text.split('\n').length).toBe(160_000)
  }, 30_000)
})

describe('lists', () => {
  it('reads bullets with a hanging indent, numbered items and a nested list', () => {
    const marker = (m: string, y: number, x = MARGIN + 8) => text(m, { x, y })
    const item = (t: string, y: number, x = MARGIN + 16) => text(t, { x, y })
    const items = [
      ...bodyLines(filler(2), { y: 80 }),
      marker('•', 120),
      item('a clean glass, polished every morning before', 120),
      item('the sun is high', 134),
      marker('•', 148),
      item('a trimmed wick', 148),
      marker('◦', 162, MARGIN + 24),
      item('cut straight', 162, MARGIN + 32),
      marker('•', 176),
      item('a full reservoir', 176),
      marker('1.', 204, MARGIN + 2),
      item('climb the stair', 204),
      marker('2.', 218, MARGIN + 2),
      item('wind the clock', 218),
      ...bodyLines(filler(2), { y: 246 }),
    ]
    const [chapter] = layoutPdf([page(1, items)], []).chapters
    expect(blockTypes(chapter)).toEqual(['paragraph', 'list', 'list', 'paragraph'])
    const bullets = chapter?.blocks[1] as ListBlock
    expect(bullets.ordered).toBe(false)
    expect(bullets.items.map((i) => runsText(i.runs))).toEqual([
      'a clean glass, polished every morning before the sun is high',
      'a trimmed wick',
      'a full reservoir',
    ])
    expect(bullets.items[1]?.lists?.[0]?.items.map((i) => runsText(i.runs))).toEqual(['cut straight'])
    const numbered = chapter?.blocks[2] as ListBlock
    expect(numbered.ordered).toBe(true)
    expect(numbered.items.map((i) => runsText(i.runs))).toEqual(['climb the stair', 'wind the clock'])
  })

  it('leaves a sentence that starts with a number as a paragraph', () => {
    const items = bodyLines(['1. is the loneliest number, the keeper said to the harbour', ...filler(2)])
    const [chapter] = layoutPdf([page(1, items)], []).chapters
    expect(blockTypes(chapter)).toEqual(['paragraph'])
  })
})

describe('footnotes', () => {
  it('gathers a chapter’s footnotes under Notes, each starting with its marker', () => {
    const items = [
      heading('Keeping the Light', 70),
      ...textLine(['The first keeper kept a diary.', ['1', { size: 7 }]], MARGIN, 100),
      ...bodyLines(filler(15), { y: 100 + LEADING }),
      text('1 The diary is kept in the', { y: 400, size: 8 }),
      text('harbour office.', { y: 410, size: 8 }),
    ]
    const marker = items[2] as PdfText
    marker.y -= 3
    const [chapter] = layoutPdf(
      [page(1, items)],
      [{ title: 'Keeping the Light', page: 1, y: 55, children: [] }],
    ).chapters
    const blocks = chapter?.blocks ?? []
    expect(blocks.at(-2)).toEqual({ type: 'heading', level: 4, runs: [{ text: NOTES }] })
    expect(blocks.at(-1)).toEqual({
      type: 'paragraph',
      runs: [{ text: '1', style: 'sup' }, { text: ' The diary is kept in the harbour office.' }],
    })
    const first = blocks.find((b) => b.type === 'paragraph')
    expect(first?.type === 'paragraph' && first.runs.some((r) => 'text' in r && r.style === 'sup')).toBe(true)
  })
})

describe('chapters', () => {
  const book = [
    chapterPage(1, 'Keeping the Light'),
    chapterPage(2, 'Signals and Codes', 16, 'signal'),
    chapterPage(3, 'Keeping Records', 16, 'record'),
  ]
  const outline: PdfOutlineEntry[] = [
    { title: 'One: The Light', page: 1, y: 55, children: [] },
    { title: 'Two: Signals', page: 2, y: 55, children: [] },
    { title: 'Three: Records', page: 3, y: 55, children: [] },
  ]

  it('come from the outline, titled by its entries', () => {
    const { chapters, report } = layoutPdf(book, outline)
    expect(chapters.map((c) => c.title)).toEqual(['One: The Light', 'Two: Signals', 'Three: Records'])
    expect(chapters[0]?.blocks[0]).toEqual({ type: 'heading', level: 3, runs: [{ text: 'Keeping the Light' }] })
    expect(report).toMatchObject({ chapters: 'outline', hasOutline: true, pages: 3 })
  })

  it('drop the chapter’s own title when it matches the outline entry', () => {
    const named = outline.map((e, i) => ({
      ...e,
      title: ['Keeping the Light', 'Signals and Codes', 'Keeping Records'][i] as string,
    }))
    const { chapters } = layoutPdf(book, named)
    expect(chapters[0]?.blocks[0]?.type).toBe('paragraph')
  })

  it('split mid-page at an outline destination', () => {
    const pages = [
      page(1, [
        heading('First', 70),
        ...bodyLines(filler(10), { y: 100 }),
        heading('Second', 260),
        ...bodyLines(filler(10, 'signal'), { y: 290 }),
      ]),
    ]
    const { chapters } = layoutPdf(pages, [
      { title: 'First', page: 1, y: 55, children: [] },
      { title: 'Second', page: 1, y: 245, children: [] },
    ])
    expect(chapters.map((c) => c.title)).toEqual(['First', 'Second'])
    expect(paragraphs(chapters[1])[0]).toMatch(/^signal 1/)
  })

  it('take a chapter title that wraps onto a second line as one title', () => {
    const wrapped = [
      page(1, [heading('Keeping the', 70), heading('Light', 94), ...bodyLines(filler(16), { y: 124 })]),
      ...book.slice(1),
    ]
    expect(layoutPdf(wrapped, []).chapters.map((c) => c.title)).toEqual([
      'Keeping the Light',
      'Signals and Codes',
      'Keeping Records',
    ])
  })

  it('come from the chapter-title headings when there is no outline, or when the reader asks', () => {
    for (const result of [layoutPdf(book, []), layoutPdf(book, outline, { chapters: 'headings' })]) {
      expect(result.chapters.map((c) => c.title)).toEqual(['Keeping the Light', 'Signals and Codes', 'Keeping Records'])
      expect(result.report.chapters).toBe('headings')
    }
  })

  it('keep text before the first chapter as Front matter', () => {
    const pages = [
      page(1, [heading('Lanterns at Sea', 70, 24), ...bodyLines(filler(4, 'abstract'), { y: 100 })]),
      ...book.map((p) => ({ ...p, number: p.number + 1 })),
    ]
    const { chapters } = layoutPdf(pages, [])
    expect(chapters[0]?.title).toBe(FRONT_MATTER)
    expect(chapters[0]?.blocks[0]).toEqual({ type: 'heading', level: 3, runs: [{ text: 'Lanterns at Sea' }] })
    expect(chapters.slice(1).map((c) => c.title)).toEqual(['Keeping the Light', 'Signals and Codes', 'Keeping Records'])
  })

  it('are one chapter, named by the book, when the headings make no chapters', () => {
    const short = [
      page(1, [
        heading('Only', 70),
        ...bodyLines(filler(3), { y: 100 }),
        heading('Two', 200),
        ...bodyLines(filler(3), { y: 230 }),
      ]),
    ]
    const { chapters, report } = layoutPdf(short, [], {}, 'Notes on lamps')
    expect(chapters.map((c) => c.title)).toEqual(['Notes on lamps'])
    expect(report.chapters).toBe('single')
    expect(chapters[0]?.blocks[0]).toEqual({ type: 'heading', level: 3, runs: [{ text: 'Only' }] })
  })

  it('follow the reader’s styles: a chapter-title style read as body text joins the body', () => {
    const { styles } = layoutPdf(book, outline)
    const title = styles.find((s) => s.font === HEAD)
    expect(title?.guess).toBe('chapter')
    const corrected = layoutPdf(book, outline, { styles: { [title?.key as string]: 'body' } })
    expect(corrected.chapters.map((c) => c.title)).toEqual(['One: The Light', 'Two: Signals', 'Three: Records'])
    expect(paragraphs(corrected.chapters[0])[0]).toBe('Keeping the Light')
    const single = layoutPdf(
      book,
      outline,
      { styles: { [title?.key as string]: 'body' }, chapters: 'headings' },
      'Book',
    )
    expect(single.chapters.map((c) => c.title)).toEqual(['Book'])
  })

  it('leave out the lines of a style read as Leave out, and the pages outside the range', () => {
    const { styles } = layoutPdf(book, [])
    const body = styles.find((s) => s.font === BODY)
    const dropped = layoutPdf(book, [], { styles: { [body?.key as string]: 'drop' } }, 'Book')
    expect(dropped.chapters).toEqual([])
    const ranged = layoutPdf(book, [], { pages: { first: 2, last: 2 } }, 'Book')
    expect(ranged.report.pages).toBe(1)
    expect(ranged.chapters.map((c) => c.title)).toEqual(['Book'])
  })
})

describe('figures and columns', () => {
  it('points image blocks at their regions, in book order, with captions', () => {
    const pages = [
      page(
        1,
        [
          ...bodyLines(filler(4), { y: 80 }),
          text('Figure 1.1 The lamp room at dusk.', { x: 140, y: 340, size: 9, font: BODY_ITALIC }),
          ...bodyLines(filler(3), { y: 380 }),
        ],
        {
          images: [box(120, 160, 180, 160)],
        },
      ),
      page(2, [...bodyLines(filler(4), { y: 80 })], { images: [box(120, 160, 180, 120)] }),
    ]
    const { chapters, regions, report } = layoutPdf(pages, [], {}, 'Book')
    const images = (chapters[0]?.blocks ?? []).filter(
      (b): b is Extract<BookBlock, { type: 'image' }> => b.type === 'image',
    )
    expect(images.map((b) => b.image)).toEqual([1, 2])
    expect(regions.map((r) => r.key)).toEqual(['pdf:1:1', 'pdf:2:1'])
    expect(images[0]?.caption).toEqual([{ text: 'Figure 1.1 The lamp room at dusk.' }])
    expect(images[1]?.alt).toBe('Figure from page 2')
    expect(report.pictures).toBe(2)
    expect(paragraphs(chapters[0]).join(' ')).not.toContain('Figure 1.1')
  })

  it('reads a two-column page left column first and counts it', () => {
    const pages = [twoColumnPage(1, filler(20, 'left'), filler(20, 'right'))]
    const { chapters, report } = layoutPdf(pages, [], {}, 'Paper')
    const text = paragraphs(chapters[0]).join(' ')
    expect(text.indexOf('left 20')).toBeLessThan(text.indexOf('right 1 '))
    expect(report.twoColumnPages).toBe(1)
  })
})
