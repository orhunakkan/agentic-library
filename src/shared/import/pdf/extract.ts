import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import type { TextContent } from 'pdfjs-dist/types/src/display/api'
import { ImportError } from '../draft.ts'
import { MAX_PDF_PAGES } from '../limits.ts'
import {
  type Box,
  charCount,
  type PdfInfo,
  type PdfOutlineEntry,
  type PdfPage,
  type PdfSource,
  type PdfText,
} from './types.ts'

export const SCANNED_MIN_CHARS = 50
export const SCAN_SAMPLE_PAGES = 20

export const PDF_SCANNED = 'This PDF is scanned pages with no text in it. Folio can’t read those yet.'
export const PDF_PASSWORD =
  'This PDF is protected by a password. Open it in a PDF app, save a copy without the password, and try that.'
export const PDF_TOO_LONG = `This PDF has more than ${new Intl.NumberFormat('en-GB').format(MAX_PDF_PAGES)} pages.`

export const BOLD = /bold|black|heavy|semibold|demi|cmbx/i
export const ITALIC = /italic|oblique|-it\b|cmti/i
export const MONO = /mono|courier|consol|menlo|inconsolata|cmtt|sfmono|code/i
export const MATH = /cmmi|cmsy|cmex|msam|msbm|math|stix|xits/i

export const OP = {
  save: 10,
  restore: 11,
  transform: 12,
  endPath: 28,
  paintFormXObjectBegin: 74,
  paintFormXObjectEnd: 75,
  paintImageMaskXObject: 83,
  paintImageXObject: 85,
  paintInlineImageXObject: 86,
  constructPath: 91,
} as const

type Matrix = [number, number, number, number, number, number]
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

function multiply(m1: readonly number[], m2: readonly number[]): Matrix {
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = m1
  const [a2 = 1, b2 = 0, c2 = 0, d2 = 1, e2 = 0, f2 = 0] = m2
  return [a * a2 + c * b2, b * a2 + d * b2, a * c2 + c * d2, b * c2 + d * d2, a * e2 + c * f2 + e, b * e2 + d * f2 + f]
}

const apply = (m: Matrix, x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
]

function boxOf(m: Matrix, x0: number, y0: number, x1: number, y1: number): Box {
  const corners = [apply(m, x0, y0), apply(m, x1, y0), apply(m, x0, y1), apply(m, x1, y1)]
  const xs = corners.map((p) => p[0])
  const ys = corners.map((p) => p[1])
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

function drawings(fnArray: readonly number[], argsArray: readonly unknown[], viewport: Matrix) {
  const images: Box[] = []
  const paths: Box[] = []
  const stack: Matrix[] = []
  let ctm: Matrix = IDENTITY
  for (let i = 0; i < fnArray.length; i++) {
    const args = argsArray[i] as unknown[] | null
    switch (fnArray[i]) {
      case OP.save:
        stack.push(ctm)
        break
      case OP.restore:
        ctm = stack.pop() ?? IDENTITY
        break
      case OP.transform:
        ctm = multiply(ctm, args as number[])
        break
      case OP.paintFormXObjectBegin: {
        stack.push(ctm)
        const matrix = args?.[0] as number[] | null | undefined
        if (matrix && matrix.length === 6) ctm = multiply(ctm, matrix)
        break
      }
      case OP.paintFormXObjectEnd:
        ctm = stack.pop() ?? IDENTITY
        break
      case OP.paintImageXObject:
      case OP.paintInlineImageXObject:
      case OP.paintImageMaskXObject:
        images.push(boxOf(multiply(viewport, ctm), 0, 0, 1, 1))
        break
      case OP.constructPath: {
        const [paint, , minMax] = (args ?? []) as [number, unknown, ArrayLike<number> | null]
        if (paint === OP.endPath || !minMax || minMax.length < 4) break
        const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = Array.from(minMax)
        if (!Number.isFinite(x0) || !Number.isFinite(x1) || x1 < x0 || y1 < y0) break
        paths.push(boxOf(multiply(viewport, ctm), x0, y0, x1, y1))
        break
      }
    }
  }
  return { images, paths }
}

function fontName(page: PDFPageProxy, id: string): string {
  let loaded: { name?: unknown } | undefined
  try {
    loaded = page.commonObjs.get(id) as { name?: unknown } | undefined
  } catch {}
  const name = typeof loaded?.name === 'string' && loaded.name ? loaded.name : id
  return name.replace(/^[A-Z]{6}\+/, '')
}

function textItems(page: PDFPageProxy, content: TextContent, viewport: Matrix): PdfText[] {
  const items: PdfText[] = []
  for (const item of content.items) {
    if (!('str' in item) || !item.str.trim()) continue
    const itemTransform = multiply(viewport, item.transform)
    const font = fontName(page, item.fontName)
    const size = Math.hypot(itemTransform[0], itemTransform[1])
    const rotated = !(
      itemTransform[0] > 0 &&
      Math.abs(itemTransform[1]) <= itemTransform[0] * 0.01 &&
      Math.abs(itemTransform[2]) <= Math.abs(itemTransform[3]) * 0.01
    )
    items.push({
      text: item.str,
      x: itemTransform[4],
      y: itemTransform[5],
      width: item.width,
      size,
      font,
      bold: BOLD.test(font),
      italic: ITALIC.test(font),
      mono: MONO.test(font) || content.styles[item.fontName]?.fontFamily === 'monospace',
      math: MATH.test(font),
      rotated,
    })
  }
  return items
}

async function readPage(page: PDFPageProxy, number: number): Promise<PdfPage> {
  const viewport = page.getViewport({ scale: 1 })
  const transform = viewport.transform as Matrix
  const operators = await page.getOperatorList()
  const content = await page.getTextContent()
  const { images, paths } = drawings(operators.fnArray, operators.argsArray, transform)
  return {
    number,
    width: viewport.width,
    height: viewport.height,
    items: textItems(page, content, transform),
    images,
    paths,
  }
}

const textChars = (page: PdfPage) => page.items.reduce((n, item) => n + charCount(item.text), 0)
const drawnOn = (page: PdfPage) => page.items.length > 0 || page.images.length > 0 || page.paths.length > 0

export interface ExtractOptions {
  signal?: AbortSignal
  onProgress?: (done: number, total: number) => void
  pages?: { first: number; last: number }
}

export async function extractPdf(doc: PDFDocumentProxy, options: ExtractOptions = {}): Promise<PdfSource> {
  const { signal, onProgress } = options
  if (doc.numPages > MAX_PDF_PAGES) throw new ImportError(PDF_TOO_LONG)
  const first = Math.max(1, options.pages?.first ?? 1)
  const last = Math.min(doc.numPages, options.pages?.last ?? doc.numPages)
  const total = Math.max(0, last - first + 1)
  const pages: PdfPage[] = []
  const sample = { pages: 0, chars: 0, decided: false }
  const decide = () => {
    sample.decided = true
    if (sample.pages && sample.chars / sample.pages < SCANNED_MIN_CHARS) throw new ImportError(PDF_SCANNED)
  }
  for (let pageNumber = first; pageNumber <= last; pageNumber++) {
    signal?.throwIfAborted()
    const page = await doc.getPage(pageNumber)
    let read: PdfPage
    try {
      read = await readPage(page, pageNumber)
    } finally {
      page.cleanup()
    }
    pages.push(read)
    if (!sample.decided && drawnOn(read)) {
      sample.pages++
      sample.chars += textChars(read)
      if (sample.pages === SCAN_SAMPLE_PAGES) decide()
    }
    onProgress?.(pages.length, total)
  }
  if (!sample.decided) decide()
  signal?.throwIfAborted()
  const outline = await readOutline(doc)
  const info = await readInfo(doc)
  return { pages, outline, info }
}

type OutlineNode = Awaited<ReturnType<PDFDocumentProxy['getOutline']>>[number]

function destinationTop(dest: readonly unknown[]): { x: number; y: number } | null {
  const kind = (dest[1] as { name?: string } | undefined)?.name
  const num = (i: number) => (typeof dest[i] === 'number' ? (dest[i] as number) : null)
  switch (kind) {
    case 'XYZ':
      return num(3) === null ? null : { x: num(2) ?? 0, y: num(3) as number }
    case 'FitH':
    case 'FitBH':
      return num(2) === null ? null : { x: 0, y: num(2) as number }
    case 'FitR':
      return num(5) === null ? null : { x: num(2) ?? 0, y: num(5) as number }
    default:
      return null
  }
}

async function readOutline(doc: PDFDocumentProxy): Promise<PdfOutlineEntry[]> {
  let nodes: OutlineNode[] | null
  try {
    nodes = await doc.getOutline()
  } catch {
    return []
  }
  const viewports = new Map<number, Matrix>()
  const pageTransform = async (page: number) => {
    let viewportTransform = viewports.get(page)
    if (!viewportTransform) {
      const proxy = await doc.getPage(page)
      viewportTransform = proxy.getViewport({ scale: 1 }).transform as Matrix
      viewports.set(page, viewportTransform)
    }
    return viewportTransform
  }
  const resolve = async (node: OutlineNode): Promise<{ page: number; y: number } | null> => {
    try {
      const dest = typeof node.dest === 'string' ? await doc.getDestination(node.dest) : node.dest
      if (!Array.isArray(dest) || !dest.length) return null
      const ref = dest[0]
      const index = typeof ref === 'number' ? ref : await doc.getPageIndex(ref)
      const page = index + 1
      if (!Number.isInteger(page) || page < 1 || page > doc.numPages) return null
      const top = destinationTop(dest)
      if (!top) return { page, y: 0 }
      const [, y] = apply(await pageTransform(page), top.x, top.y)
      return { page, y: Math.max(0, y) }
    } catch {
      return null
    }
  }
  const walk = async (list: readonly OutlineNode[]): Promise<PdfOutlineEntry[]> => {
    const entries: PdfOutlineEntry[] = []
    for (const node of list) {
      const children = await walk(node.items ?? [])
      const target = await resolve(node)
      if (target) entries.push({ title: (node.title ?? '').trim(), ...target, children })
      else entries.push(...children)
    }
    return entries
  }
  return walk(nodes ?? [])
}

const nonEmpty = (value: unknown): string | null => {
  const text = Array.isArray(value) ? value.filter((v) => typeof v === 'string').join(', ') : value
  return typeof text === 'string' && text.trim() ? text.trim() : null
}

async function readInfo(doc: PDFDocumentProxy): Promise<PdfInfo> {
  try {
    const { info, metadata } = await doc.getMetadata()
    const fields = (info ?? {}) as Record<string, unknown>
    return {
      title: nonEmpty(fields.Title),
      author: nonEmpty(fields.Author),
      xmpTitle: nonEmpty(metadata?.get('dc:title')),
      xmpCreator: nonEmpty(metadata?.get('dc:creator')),
      language: nonEmpty(fields.Language),
    }
  } catch {
    return { title: null, author: null, xmpTitle: null, xmpCreator: null, language: null }
  }
}

export function pdfOpenError(error: unknown): ImportError {
  if (error instanceof ImportError) return error
  if ((error as { name?: unknown } | null)?.name === 'PasswordException') return new ImportError(PDF_PASSWORD)
  const message = error instanceof Error ? error.message : String(error)
  return new ImportError(`This file couldn’t be read: ${message}.`)
}
