import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PdfStyle } from '../../../src/shared/import/pdf/types.ts'
import { readPdf, resolveStyles, withoutPictures } from './pdf.ts'

const style = (font: string, size: number): PdfStyle => ({
  key: `${font}@${size}`,
  font,
  size,
  chars: 100,
  sample: '',
  guess: 'body',
})

describe('resolveStyles', () => {
  it('names each style the first matching rule gives a kind, by font and, when given, size', () => {
    const styles = [style('Geist-Bold', 20), style('Geist-Bold', 13), style('JetBrainsMono-Regular', 8.5)]
    expect(
      resolveStyles(styles, [
        { font: /Geist-Bold/, size: 20.2, kind: 'chapter' },
        { font: /Geist/, kind: 'h4' },
        { font: /Mono/, size: 10, kind: 'drop' },
      ]),
    ).toEqual({ 'Geist-Bold@20': 'chapter', 'Geist-Bold@13': 'h4' })
  })
})

describe('withoutPictures', () => {
  it('keeps a figure’s caption and leaves out one without', () => {
    const chapters = withoutPictures([
      {
        title: 'One',
        blocks: [
          { type: 'image', image: 1, alt: 'a', caption: [{ text: 'Figure 1' }] },
          { type: 'image', image: 2, alt: 'b' },
          { type: 'paragraph', runs: [{ text: 'text' }] },
        ],
      },
    ])
    expect(chapters[0]?.blocks).toEqual([
      { type: 'image', image: 0, alt: 'a', caption: [{ text: 'Figure 1' }] },
      { type: 'paragraph', runs: [{ text: 'text' }] },
    ])
  })
})

describe('readPdf', () => {
  const handbook = readFileSync(join(import.meta.dirname, '../../../tests/e2e/fixtures/imports/pdf-handbook.pdf'))

  it('reads the handbook fixture into its three chapters, figures as captions', async () => {
    const chapters = await readPdf(handbook, { firstPage: 1, lastPage: 9 }, 'Handbook')
    expect(chapters.map((c) => c.title)).toEqual(['Keeping the Light', 'Signals and Codes', 'Keeping Records'])
    const html = chapters[0]?.blocks.map((b) => b.html).join('') ?? ''
    expect(html).toContain('<pre>')
    expect(html).toContain('Figure 1.1 The lamp room at dusk.')
    expect(html).not.toContain('<img')
  })

  it('reads a range of pages with the configured kinds', async () => {
    const chapters = await readPdf(
      handbook,
      { firstPage: 1, lastPage: 3, styles: [{ font: /Geist-Bold/, size: 20, kind: 'body' }] },
      'Handbook',
    )
    expect(chapters.map((c) => c.title)).toEqual(['Handbook'])
    expect(chapters[0]?.blocks[0]?.html).toBe('<p>Keeping the Light</p>')
  })

  it('refuses a file that isn’t a PDF', async () => {
    await expect(readPdf(Buffer.from('not a pdf'), { firstPage: 1, lastPage: 1 }, 'x')).rejects.toThrow(
      /couldn’t be read/,
    )
  })
})
