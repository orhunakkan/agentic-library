import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { beforeAll, describe, expect, it } from 'vitest'
import type { DraftChapter } from '../blocks.ts'
import { NO_PICTURES, type RenderContext, renderBlocks } from '../render.ts'
import { extractPdf } from './extract.ts'
import { layoutPdf } from './layout.ts'
import { pdfMetadata } from './metadata.ts'
import { styleKinds } from './styles.ts'
import type { PdfOverrides, PdfSource } from './types.ts'

const FIXTURES = join(import.meta.dirname, '../../../../tests/e2e/fixtures/imports')
const HANDBOOK_CHAPTERS = ['Keeping the Light', 'Signals and Codes', 'Keeping Records']

const PICTURES: RenderContext = { imageSrc: (n) => `picture-${n}`, imageSize: () => ({ width: 400, height: 300 }) }

const html = (chapter: DraftChapter | undefined, context = PICTURES) =>
  renderBlocks(chapter?.blocks ?? [], context)
    .map((b) => b.html)
    .join('\n')

async function read(file: string): Promise<{ source: PdfSource; title: string }> {
  const task = getDocument({
    data: new Uint8Array(readFileSync(join(FIXTURES, file))),
    fontExtraProperties: true,
    verbosity: 0,
  })
  try {
    const source = await extractPdf(await task.promise)
    return { source, title: pdfMetadata(source.info, source.pages, file).title }
  } finally {
    await task.destroy()
  }
}

describe('a two-column paper (pdf-paper.pdf)', () => {
  let source: PdfSource
  let title: string
  beforeAll(async () => ({ source, title } = await read('pdf-paper.pdf')))

  const layout = () => layoutPdf(source.pages, source.outline, {}, title)

  it('takes its title from the first page and its chapters from the headings', () => {
    expect(title).toBe('Lanterns at Sea: A Short Study')
    const { chapters, report } = layout()
    expect(chapters.map((c) => c.title)).toEqual([
      'Front matter',
      '1 Introduction',
      '2 Method',
      '3 Results',
      '4 Discussion',
    ])
    expect(report).toEqual({
      pages: 4,
      chapters: 'headings',
      hasOutline: false,
      twoColumnPages: 4,
      furniturePages: 4,
      pictures: 2,
    })
  })

  it('keeps the front matter’s title and abstract', () => {
    const front = html(layout().chapters[0])
    expect(front).toContain('Lanterns at Sea: A Short Study')
    expect(front).toMatch(/<strong>Abstract\.<\/strong>/)
  })

  it('reads the left column, then the right: whole paragraphs, not lines mixed across the gutter', () => {
    const introduction = html(layout().chapters[1])
    const paragraphs = [...introduction.matchAll(/<p>(.*?)<\/p>/gs)].map((m) => m[1] as string)
    expect(paragraphs).toHaveLength(5)
    expect(paragraphs[0]).toMatch(/^orchard window lantern morning story compass/)
  })

  it('makes the equation and the chart figures with alt text, and gathers the footnotes', () => {
    const { chapters } = layout()
    const method = html(chapters[2])
    expect(method).toMatch(/<figure>.*<img[^>]+alt="f\(x\) = a·x \+ b·y − c"/s)
    expect(method).toMatch(/<h4[^>]*>Notes<\/h4>\s*<p><sup>1<\/sup> Four harbours on the north coast\.<\/p>/)
    const results = html(chapters[3])
    expect(results).toContain('Figure 1. Nights lit at each of the four harbours.')
    expect(results).toContain('alt="Nights lit per harbour"')
    expect(results).not.toContain('<p>Nights lit per harbour</p>')
    expect(html(chapters[3], NO_PICTURES)).toContain(
      '<figure><figcaption>Figure 1. Nights lit at each of the four harbours.</figcaption></figure>',
    )
  })
})

describe('a handbook laid out again after a correction (pdf-handbook.pdf)', () => {
  let source: PdfSource
  let title: string
  beforeAll(async () => ({ source, title } = await read('pdf-handbook.pdf')))

  const layout = (overrides: PdfOverrides = {}) => layoutPdf(source.pages, source.outline, overrides, title)

  const chapterStyle = () => {
    const style = layout().styles.find((s) => /Geist-Bold$/.test(s.font) && s.size === 20)
    if (!style) throw new Error('no Geist-Bold 20pt style')
    return style
  }

  it('reads its chapters from the bookmarks, with the chapter titles’ style guessed as chapter titles', () => {
    const { chapters, report } = layout()
    expect(chapters.map((c) => c.title)).toEqual(HANDBOOK_CHAPTERS)
    expect(report.chapters).toBe('outline')
    expect(chapterStyle().guess).toBe('chapter')
  })

  it('reading the chapter titles as body text keeps the bookmarks’ chapters, each title now a line of its body', () => {
    const styles = { [chapterStyle().key]: 'body' as const }
    const corrected = layout({ styles })
    expect(corrected.chapters.map((c) => c.title)).toEqual(HANDBOOK_CHAPTERS)
    expect(styleKinds(corrected.styles, styles).get(chapterStyle().key)).toBe('body')
    expect(html(corrected.chapters[0])).toMatch(/<p>Keeping the Light<\/p>/)
  })

  it('with chapters from the headings and no chapter-title style left, the book is one chapter', () => {
    const single = layout({ styles: { [chapterStyle().key]: 'body' }, chapters: 'headings' })
    expect(single.chapters.map((c) => c.title)).toEqual(['The Lantern Handbook'])
    expect(single.report.chapters).toBe('single')
  })
})
