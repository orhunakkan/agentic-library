import {
  type Box,
  type LineRun,
  type PdfLine,
  type PdfPage,
  type PdfText,
  styleKey,
} from '~/shared/import/pdf/types.ts'

export const BODY = 'Serif-Regular'
export const BODY_BOLD = 'Serif-Bold'
export const BODY_ITALIC = 'Serif-Italic'
export const HEAD = 'Sans-Bold'
export const MONO = 'Mono-Regular'
export const MATH = 'Math-Regular'

export const PAGE_WIDTH = 420
export const PAGE_HEIGHT = 595
export const MARGIN = 45
export const BODY_SIZE = 10
export const LEADING = 14

const flags = (font: string) => ({
  bold: /bold/i.test(font),
  italic: /italic/i.test(font),
  mono: /mono/i.test(font),
  math: /math/i.test(font),
})

export const textWidth = (text: string, size: number, font: string): number =>
  text.length * size * (/mono/i.test(font) ? 0.6 : 0.5)

export interface TextOptions {
  x?: number
  y?: number
  size?: number
  font?: string
  width?: number
  rotated?: boolean
}

export function text(value: string, options: TextOptions = {}): PdfText {
  const { x = MARGIN, y = 100, size = BODY_SIZE, font = BODY, rotated = false } = options
  return {
    text: value,
    x,
    y,
    width: options.width ?? textWidth(value, size, font),
    size,
    font,
    ...flags(font),
    rotated,
  }
}

export function textLine(parts: readonly (string | [string, Omit<TextOptions, 'x' | 'y'>])[], x: number, y: number) {
  const items: PdfText[] = []
  let left = x
  for (const part of parts) {
    const [value, options] = typeof part === 'string' ? [part, {}] : part
    const item = text(value, { ...options, x: left, y })
    items.push(item)
    left += item.width + item.size * 0.25
  }
  return items
}

export interface PageOptions {
  width?: number
  height?: number
  images?: Box[]
  paths?: Box[]
}

export function page(number: number, items: PdfText[], options: PageOptions = {}): PdfPage {
  const { width = PAGE_WIDTH, height = PAGE_HEIGHT, images = [], paths = [] } = options
  return { number, width, height, items, images, paths }
}

export function bodyLines(lines: readonly string[], options: { x?: number; y?: number; leading?: number } = {}) {
  const { x = MARGIN, y = 100, leading = LEADING } = options
  return lines.map((value, i) => text(value, { x, y: y + i * leading }))
}

export const heading = (value: string, y: number, size = 20, font = HEAD): PdfText =>
  text(value, { x: MARGIN, y, size, font })

export const codeLine = (value: string, y: number, x = MARGIN + 10): PdfText =>
  text(value, { x, y, size: 8.5, font: MONO })

export const box = (x: number, y: number, width: number, height: number): Box => ({ x, y, width, height })

export function twoColumnPage(
  number: number,
  left: readonly string[],
  right: readonly string[],
  options: { title?: string; gutter?: number } = {},
): PdfPage {
  const width = 595
  const margin = 54
  const gutter = options.gutter ?? 25
  const column = (width - 2 * margin - gutter) / 2
  const top = options.title ? 140 : 80
  const items: PdfText[] = []
  if (options.title) items.push(text(options.title, { x: margin + 60, y: 80, size: 18, font: HEAD }))
  items.push(...bodyLines(left, { x: margin, y: top, leading: 12 }))
  items.push(...bodyLines(right, { x: margin + column + gutter, y: top, leading: 12 }))
  return page(number, items, { width, height: 842 })
}

export const filler = (count: number, word = 'harbour'): string[] =>
  Array.from({ length: count }, (_, i) => `${word} ${i + 1} lantern river stone quiet morning`)

export interface LineOptions {
  page?: number
  x?: number
  y?: number
  size?: number
  font?: string
  width?: number
}

export function run(value: string, options: Omit<LineOptions, 'page' | 'y'> & { sup?: boolean } = {}): LineRun {
  const { x = MARGIN, size = BODY_SIZE, font = BODY, sup = false } = options
  return {
    text: value,
    x,
    width: options.width ?? textWidth(value, size, font),
    size,
    font,
    style: styleKey(font, size),
    ...flags(font),
    sup,
  }
}

export function line(value: string, options: LineOptions = {}): PdfLine {
  const { page = 1, x = MARGIN, y = 100, size = BODY_SIZE, font = BODY } = options
  const only = run(value, { x, size, font, width: options.width })
  return { page, x, y, width: only.width, size, style: only.style, runs: [only], text: value }
}

export function linesOf(runs: readonly LineRun[], options: { page?: number; y?: number } = {}): PdfLine {
  const { page = 1, y = 100 } = options
  const main = runs.filter((r) => !r.sup)
  const chars = new Map<string, number>()
  for (const r of main) chars.set(r.style, (chars.get(r.style) ?? 0) + r.text.replace(/\s/g, '').length)
  const style = [...chars].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
  const first = runs[0] as LineRun
  const last = runs.at(-1) as LineRun
  return {
    page,
    x: first.x,
    y,
    width: last.x + last.width - first.x,
    size: main.find((r) => r.style === style)?.size ?? first.size,
    style,
    runs: [...runs],
    text: runs.map((r) => r.text).join(' '),
  }
}

export function runsFrom(
  x: number,
  parts: readonly (string | [string, { font?: string; size?: number; sup?: boolean }])[],
) {
  let left = x
  return parts.map((part) => {
    const [value, options] = typeof part === 'string' ? [part, {}] : part
    const r = run(value, { ...options, x: left })
    left += r.width + r.size * 0.25
    return r
  })
}
