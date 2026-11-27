import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist'
import type { DraftBook, SourceCover, SourcePicture } from '~/shared/import/blocks'
import { finishDraft, ImportError } from '~/shared/import/draft'
import { sniffImage } from '~/shared/import/image'
import { IMAGE_MAX_HEIGHT, IMAGE_MAX_WIDTH } from '~/shared/import/limits'
import { extractPdf, pdfOpenError } from '~/shared/import/pdf/extract'
import { layoutPdf } from '~/shared/import/pdf/layout'
import { pdfMetadata } from '~/shared/import/pdf/metadata'
import type { Box, PdfLayoutReport, PdfOverrides, PdfSource, PdfStyle, Region } from '~/shared/import/pdf/types'
import { type Canvas, canvasBlob, canvasOf } from './picture-draw'

export type PdfProgress = { stage: 'reading' | 'drawing'; done: number; total: number }

export interface PdfRead {
  draft: DraftBook
  styles: PdfStyle[]
  report: PdfLayoutReport
  overrides: PdfOverrides
}

interface OpenOptions {
  signal?: AbortSignal
  onProgress?: (p: PdfProgress) => void
}

export interface PdfBook extends PdfRead {
  reread(overrides: PdfOverrides, options?: OpenOptions): Promise<PdfRead>
  close(): void
}

export const CROP_PADDING = 4
const CROP_SCALE = 2
const COVER_SHARE = 0.6
const COVER_WIDTH = 1200
const COVER_QUALITY = 0.85
const WHITE = '#ffffff'

type Context = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

async function toBytes(canvas: Canvas, type: 'image/png' | 'image/jpeg', quality?: number): Promise<Uint8Array> {
  const blob = await canvasBlob(canvas, type, quality)
  if (!blob) throw new Error('the canvas could not be read back')
  return new Uint8Array(await blob.arrayBuffer())
}

export function paddedBox(box: Box, page: { width: number; height: number }): Box {
  const x = Math.max(0, box.x - CROP_PADDING)
  const y = Math.max(0, box.y - CROP_PADDING)
  const right = Math.min(page.width, box.x + box.width + CROP_PADDING)
  const bottom = Math.min(page.height, box.y + box.height + CROP_PADDING)
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) }
}

export const cropScale = (box: Box): number =>
  Math.min(CROP_SCALE, IMAGE_MAX_WIDTH / box.width, IMAGE_MAX_HEIGHT / box.height)

async function render(
  doc: PDFDocumentProxy,
  number: number,
  box: Box | null,
  scale: number,
  type: 'image/png' | 'image/jpeg',
  quality?: number,
): Promise<Uint8Array> {
  const page = await doc.getPage(number)
  try {
    const viewport = page.getViewport({ scale })
    const area = box ?? { x: 0, y: 0, width: viewport.width / scale, height: viewport.height / scale }
    const width = Math.max(1, Math.ceil(area.width * scale))
    const height = Math.max(1, Math.ceil(area.height * scale))
    const canvas = canvasOf(width, height)
    const context = canvas.getContext('2d') as Context | null
    if (!context) throw new Error('no canvas')
    context.fillStyle = WHITE
    context.fillRect(0, 0, width, height)
    await page.render({
      canvas: null,
      canvasContext: context as CanvasRenderingContext2D,
      viewport,
      transform: [1, 0, 0, 1, -area.x * scale, -area.y * scale],
      background: WHITE,
    }).promise
    return await toBytes(canvas, type, quality)
  } finally {
    page.cleanup()
  }
}

const boxKey = (page: number, box: Box) =>
  `${page}:${[box.x, box.y, box.width, box.height].map((v) => Math.round(v * 10) / 10).join(',')}`

async function coverOf(doc: PDFDocumentProxy, source: PdfSource): Promise<SourceCover | null> {
  const first = source.pages[0]
  if (first?.number !== 1) return null
  const area = first.width * first.height
  const covered = first.images.some((b) => {
    const w = Math.min(b.x + b.width, first.width) - Math.max(b.x, 0)
    const h = Math.min(b.y + b.height, first.height) - Math.max(b.y, 0)
    return w > 0 && h > 0 && w * h >= COVER_SHARE * area
  })
  if (!covered) return null
  try {
    const bytes = await render(
      doc,
      1,
      null,
      Math.min(CROP_SCALE, COVER_WIDTH / first.width),
      'image/jpeg',
      COVER_QUALITY,
    )
    const info = sniffImage(bytes)
    return info ? { bytes, info, from: 'pdf' } : null
  } catch {
    return null
  }
}

function readError(error: unknown, signal?: AbortSignal): unknown {
  if (signal?.aborted) return signal.reason
  if (error instanceof ImportError) return error
  const message = error instanceof Error ? error.message : String(error)
  return new ImportError(`This file couldn’t be read: ${message}.`)
}

let workerSet = false

async function loadPdfjs() {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
  if (!workerSet) {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default
    workerSet = true
  }
  return pdfjs
}

export async function openPdf(fileName: string, bytes: Uint8Array, options: OpenOptions = {}): Promise<PdfBook> {
  const { signal, onProgress } = options
  signal?.throwIfAborted()
  const pdfjs = await loadPdfjs()
  const task: PDFDocumentLoadingTask = pdfjs.getDocument({ data: bytes, fontExtraProperties: true, verbosity: 0 })
  const free = () => void task.destroy()
  let doc: PDFDocumentProxy
  try {
    doc = await task.promise
  } catch (error) {
    free()
    throw pdfOpenError(error)
  }

  const crops = new Map<string, Uint8Array | null>()
  let source: PdfSource | null = null
  let cover: SourceCover | null = null

  async function layOut(extracted: PdfSource, overrides: PdfOverrides, step: OpenOptions): Promise<PdfRead> {
    const meta = pdfMetadata(extracted.info, extracted.pages, fileName)
    const layout = layoutPdf(extracted.pages, extracted.outline, overrides, meta.title)
    const pages = new Map(extracted.pages.map((p) => [p.number, p]))
    const wanted = layout.regions.filter((r) => !crops.has(boxKey(r.page, r.box)))
    for (const [done, region] of wanted.entries()) {
      step.signal?.throwIfAborted()
      step.onProgress?.({ stage: 'drawing', done, total: wanted.length })
      crops.set(boxKey(region.page, region.box), await crop(region, pages.get(region.page)))
    }
    if (wanted.length) step.onProgress?.({ stage: 'drawing', done: wanted.length, total: wanted.length })
    const pictures = layout.regions.map((r): SourcePicture => {
      const cropped = crops.get(boxKey(r.page, r.box))
      return cropped ? { key: r.key, bytes: cropped, type: 'image/png' } : { key: r.key, problem: 'unreadable' }
    })
    const draft = finishDraft({
      title: meta.title,
      author: meta.author,
      language: meta.language,
      details: { description: null, isbn: meta.isbn, publisher: null, publishedYear: null },
      cover,
      chapters: layout.chapters,
      pictures,
    })
    return { draft, styles: layout.styles, report: layout.report, overrides }
  }

  async function crop(region: Region, page: { width: number; height: number } | undefined): Promise<Uint8Array | null> {
    if (!page) return null
    const box = paddedBox(region.box, page)
    try {
      return await render(doc, region.page, box, cropScale(box), 'image/png')
    } catch {
      return null
    }
  }

  try {
    source = await extractPdf(doc, {
      signal,
      onProgress: (done, total) => onProgress?.({ stage: 'reading', done, total }),
    })
    cover = await coverOf(doc, source)
    const first = await layOut(source, {}, { signal, onProgress })
    return {
      ...first,
      reread: async (overrides, step = {}) => {
        if (!source) throw new ImportError('This PDF has been closed. Choose the file again.')
        try {
          return await layOut(source, overrides, step)
        } catch (error) {
          throw readError(error, step.signal)
        }
      },
      close: () => {
        source = null
        crops.clear()
        free()
      },
    }
  } catch (error) {
    free()
    throw readError(error, signal)
  }
}
