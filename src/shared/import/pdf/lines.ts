import { charCount, type LineRun, type PdfLine, type PdfPage, type PdfText, styleKey } from './types.ts'

export const LINE_TOLERANCE = 0.3
export const SPACE_GAP = 0.15
export const SPLIT_GAP = 1.5
export const SUP_SMALLER = 0.15
export const SUP_RAISE = 0.25
const SUP_RAISE_MAX = 0.6
export const FURNITURE_BAND = 0.08
export const REPEAT_MIN_PAGES = 3
export const REPEAT_MIN_SHARE = 0.2

interface Baseline {
  items: PdfText[]
  sups: PdfText[]
  y: number
  size: number
}

function mainOf(items: readonly PdfText[]): { size: number; y: number } {
  const chars = new Map<number, number>()
  for (const item of items) chars.set(item.size, (chars.get(item.size) ?? 0) + charCount(item.text))
  const size = [...chars].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 0
  return { size, y: items.find((i) => i.size === size)?.y ?? 0 }
}

function isSuperscript(item: PdfText, size: number, y: number): boolean {
  const raise = y - item.y
  return item.size <= size * (1 - SUP_SMALLER) && raise >= size * SUP_RAISE && raise <= size * SUP_RAISE_MAX
}

function baselines(items: readonly PdfText[]): Baseline[] {
  const groups: PdfText[][] = []
  for (const item of [...items].sort((a, b) => a.y - b.y)) {
    const group = groups.find((g) =>
      g.some((other) => Math.abs(other.y - item.y) <= LINE_TOLERANCE * Math.max(other.size, item.size)),
    )
    if (group) group.push(item)
    else groups.push([item])
  }
  const lines: Baseline[] = groups.map((g) => ({ items: g, sups: [], ...mainOf(g) }))
  for (const line of lines) {
    const sups = line.items.filter((i) => isSuperscript(i, line.size, line.y))
    line.items = line.items.filter((i) => !sups.includes(i))
    line.sups.push(...sups)
  }
  for (const line of lines) {
    const kept: PdfText[] = []
    for (const item of line.items) {
      const host = lines.find(
        (other) =>
          other !== line &&
          other.items.length &&
          isSuperscript(item, other.size, other.y) &&
          other.items.some((i) => item.x >= i.x - other.size && item.x <= i.x + i.width + other.size),
      )
      if (host) host.sups.push(item)
      else kept.push(item)
    }
    line.items = kept
  }
  return lines.filter((l) => l.items.length)
}

function toRun(item: PdfText, sup: boolean): LineRun {
  const { text, x, width, size, font, bold, italic, mono, math } = item
  return { text, x, width, size, font, style: styleKey(font, size), bold, italic, mono, math, sup }
}

function toLine(page: number, y: number, runs: LineRun[]): PdfLine {
  const chars = new Map<string, { chars: number; size: number }>()
  for (const r of runs.filter((r) => !r.sup)) {
    const entry = chars.get(r.style) ?? { chars: 0, size: r.size }
    entry.chars += charCount(r.text)
    chars.set(r.style, entry)
  }
  const [style = '', main] = [...chars].sort((a, b) => b[1].chars - a[1].chars)[0] ?? []
  const first = runs[0] as LineRun
  const last = runs.at(-1) as LineRun
  return {
    page,
    x: first.x,
    y,
    width: last.x + last.width - first.x,
    size: main?.size ?? first.size,
    style,
    runs,
    text: runs
      .map((r) => r.text)
      .join('')
      .trim(),
  }
}

function splitBaseline(page: number, baseline: Baseline): PdfLine[] {
  const runs = [...baseline.items.map((i) => toRun(i, false)), ...baseline.sups.map((i) => toRun(i, true))].sort(
    (a, b) => a.x - b.x,
  )
  const lines: LineRun[][] = []
  let previous: LineRun | undefined
  for (const run of runs) {
    const current = lines.at(-1)
    if (!previous || !current) {
      lines.push([run])
      previous = run
      continue
    }
    const gap = run.x - (previous.x + previous.width)
    const size = Math.max(previous.size, run.size)
    if (gap > SPLIT_GAP * size) lines.push([run])
    else {
      if (gap > SPACE_GAP * size && !/\s$/.test(previous.text) && !/^\s/.test(run.text)) previous.text += ' '
      current.push(run)
    }
    previous = run
  }
  return lines.map((l) => toLine(page, baseline.y, l))
}

export function pageLines(page: PdfPage): PdfLine[] {
  const items = page.items.filter((i) => !i.rotated && i.text.trim())
  return topToBottom(baselines(items).flatMap((b) => splitBaseline(page.number, b)))
}

export function topToBottom(lines: readonly PdfLine[]): PdfLine[] {
  const sorted = [...lines].sort((a, b) => a.y - b.y)
  const rows: PdfLine[][] = []
  for (const line of sorted) {
    const row = rows.at(-1)
    const first = row?.[0]
    if (row && first && Math.abs(line.y - first.y) <= LINE_TOLERANCE * Math.min(line.size, first.size)) row.push(line)
    else rows.push([line])
  }
  return rows.flatMap((row) => row.sort((a, b) => a.x - b.x))
}

const PAGE_NUMBER = /^[-–—\s]*(\d+|[ivxlcdm]+|[IVXLCDM]+)[-–—\s]*$/

const repeatKey = (line: PdfLine) => line.text.replace(/\d/g, '#').replace(/\s+/g, ' ').trim()

const inBand = (line: PdfLine, height: number) =>
  line.y <= height * FURNITURE_BAND || line.y >= height * (1 - FURNITURE_BAND)

export function removeFurniture(
  lines: readonly PdfLine[][],
  pages: readonly { height: number }[],
): { pages: PdfLine[][]; furniturePages: number } {
  const band = lines.map((pageLines, i) => pageLines.filter((l) => inBand(l, pages[i]?.height ?? 0)))
  const seenOn = new Map<string, Set<number>>()
  band.forEach((pageLines, i) => {
    for (const line of pageLines) {
      const key = repeatKey(line)
      const set = seenOn.get(key) ?? new Set<number>()
      set.add(i)
      seenOn.set(key, set)
    }
  })
  const repeats = (line: PdfLine) => {
    const count = seenOn.get(repeatKey(line))?.size ?? 0
    return count >= REPEAT_MIN_PAGES && count >= REPEAT_MIN_SHARE * lines.length
  }
  let furniturePages = 0
  const kept = lines.map((pageLines, i) => {
    const furniture = new Set((band[i] ?? []).filter((l) => PAGE_NUMBER.test(l.text) || repeats(l)))
    if (furniture.size) furniturePages++
    return pageLines.filter((l) => !furniture.has(l))
  })
  return { pages: kept, furniturePages }
}
