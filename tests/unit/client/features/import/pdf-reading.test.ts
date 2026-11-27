import { describe, expect, it } from 'vitest'
import {
  bodyOf,
  chapterSource,
  fontText,
  KIND_LABELS,
  kindOf,
  readingSummary,
  sampleScale,
  shareText,
  withKind,
} from '~/client/features/import/pdf-reading'
import type { PdfLayoutReport, PdfStyle } from '~/shared/import/pdf/types'

const report = (over: Partial<PdfLayoutReport> = {}): PdfLayoutReport => ({
  pages: 412,
  chapters: 'outline',
  hasOutline: true,
  twoColumnPages: 12,
  furniturePages: 398,
  pictures: 23,
  ...over,
})

const style = (key: string, chars: number, over: Partial<PdfStyle> = {}): PdfStyle => ({
  key,
  font: key,
  size: 10,
  chars,
  sample: '',
  guess: 'body',
  ...over,
})

describe('readingSummary', () => {
  it('says every part that applies', () => {
    expect(readingSummary(report())).toBe(
      '412 pages · chapters from the PDF’s bookmarks · two columns on 12 pages · page numbers and running headers left out on 398 pages · 23 pictures cropped from the pages.',
    )
  })

  it('leaves out what doesn’t apply, and names the other chapter sources', () => {
    const plain = { twoColumnPages: 0, furniturePages: 0, pictures: 0 }
    expect(readingSummary(report({ ...plain, chapters: 'headings', pages: 1 }))).toBe(
      '1 page · chapters from the headings.',
    )
    expect(readingSummary(report({ ...plain, chapters: 'single', pictures: 1, twoColumnPages: 1 }))).toBe(
      '412 pages · one chapter: no chapter headings were found · two columns on 1 page · 1 picture cropped from the pages.',
    )
  })
})

describe('styles', () => {
  const body = style('Minion-Regular@10.5', 7100, { font: 'Minion-Regular', size: 10.5 })
  const title = style('Minion-Bold@21', 4, { font: 'Minion-Bold', size: 21, guess: 'chapter' })
  const styles = [body, title, style('rest', 2896)]

  it('names the font and its size, and the share of characters', () => {
    expect(fontText(body)).toBe('Minion-Regular, 10.5pt')
    expect(shareText(body, styles)).toBe('71%')
    expect(shareText(style('x', 40), [style('x', 40), style('y', 9960)])).toBe('0.4%')
    expect(shareText(title, styles)).toBe('<0.1%')
    expect(shareText(body, [])).toBe('<0.1%')
  })

  it('finds the body and sizes a sample against it, within bounds', () => {
    expect(bodyOf(styles)).toBe(body)
    expect(bodyOf([])).toBeUndefined()
    expect(sampleScale(title, body)).toBe(2)
    expect(sampleScale(style('small', 1, { size: 6 }), body)).toBe(0.75)
    expect(sampleScale(body, undefined)).toBe(1)
  })

  it('reads a style as the reader chose, else as guessed', () => {
    expect(kindOf(title, {})).toBe('chapter')
    const corrected = withKind({ chapters: 'headings' }, title, 'body')
    expect(corrected).toEqual({ chapters: 'headings', styles: { [title.key]: 'body' } })
    expect(kindOf(title, corrected)).toBe('body')
    expect(KIND_LABELS.map((k) => k.label)).toEqual([
      'Chapter title',
      'Section heading',
      'Subheading',
      'Body text',
      'Code',
      'Leave out',
    ])
  })

  it('shows the chapter source as bookmarks or headings', () => {
    expect(chapterSource(report())).toBe('outline')
    expect(chapterSource(report({ chapters: 'single' }))).toBe('headings')
  })
})
