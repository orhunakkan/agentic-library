import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { BookBlock, DraftChapter } from '../../../src/shared/import/blocks.ts'
import { extractPdf, pdfOpenError } from '../../../src/shared/import/pdf/extract.ts'
import { layoutPdf } from '../../../src/shared/import/pdf/layout.ts'
import type { PdfStyle, StyleKind } from '../../../src/shared/import/pdf/types.ts'
import { NO_PICTURES, renderBlocks } from '../../../src/shared/import/render.ts'
import type { RenderedChapter } from './types.ts'

export interface StyleRule {
  font: RegExp
  size?: number
  kind: StyleKind
}

export interface PdfOptions {
  firstPage: number
  lastPage: number
  styles?: StyleRule[]
}

export function resolveStyles(styles: readonly PdfStyle[], rules: readonly StyleRule[]): Record<string, StyleKind> {
  const resolved: Record<string, StyleKind> = {}
  for (const style of styles) {
    const rule = rules.find(
      (r) => r.font.test(style.font) && (r.size === undefined || Math.abs(r.size - style.size) <= 0.25),
    )
    if (rule) resolved[style.key] = rule.kind
  }
  return resolved
}

export function withoutPictures(chapters: readonly DraftChapter[]): DraftChapter[] {
  return chapters.map((c) => ({
    title: c.title,
    blocks: c.blocks.flatMap((b): BookBlock[] => (b.type !== 'image' ? [b] : b.caption ? [{ ...b, image: 0 }] : [])),
  }))
}

export async function readPdf(file: Buffer, options: PdfOptions, title: string): Promise<RenderedChapter[]> {
  const task = getDocument({ data: new Uint8Array(file), fontExtraProperties: true, verbosity: 0 })
  try {
    let doc: Awaited<typeof task.promise>
    try {
      doc = await task.promise
    } catch (error) {
      throw pdfOpenError(error)
    }
    const pages = { first: options.firstPage, last: options.lastPage }
    const source = await extractPdf(doc, { pages })
    const guessed = layoutPdf(source.pages, source.outline, { pages }, title)
    const styles = resolveStyles(guessed.styles, options.styles ?? [])
    const layout = Object.keys(styles).length
      ? layoutPdf(source.pages, source.outline, { pages, styles }, title)
      : guessed
    return withoutPictures(layout.chapters)
      .map((c) => ({ title: c.title, blocks: renderBlocks(c.blocks, NO_PICTURES) }))
      .filter((c) => c.blocks.length)
  } finally {
    await task.destroy()
  }
}
