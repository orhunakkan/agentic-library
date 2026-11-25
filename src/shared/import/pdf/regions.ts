import { ALT_MAX, cleanAlt } from '../blocks.ts'
import type { BodyStyle } from './styles.ts'
import { type Box, charCount, type PdfLine, type PdfPage, type Region, type StyleKind } from './types.ts'

export const IMAGE_MIN_SIDE = 16
export const CLUSTER_GAP = 6
export const FIGURE_MIN_SIDE = 48
export const FIGURE_MIN_AREA = 0.02
export const RULE_MAX = 3
export const TEXT_WIDTH_SHARE = 0.4
export const MATH_SHARE = 0.5
export const CAPTION = /^(figure|fig\.|table|listing|plate|exhibit)(\s+|(?=\d))(\d|[ivxlc]+\b|[a-z]\b)/i
export const CAPTION_REACH = 2
const PAGE_BACKGROUND = 0.9
const PARAGRAPH_GAP = 1.4

export type PageItem = { line: PdfLine } | { region: Region }

const right = (b: Box) => b.x + b.width
const bottom = (b: Box) => b.y + b.height

function lineBox(line: PdfLine): Box {
  return { x: line.x, y: line.y - line.size, width: line.width, height: line.size * 1.25 }
}

export function union(boxes: readonly Box[]): Box {
  const x = Math.min(...boxes.map((b) => b.x))
  const y = Math.min(...boxes.map((b) => b.y))
  return { x, y, width: Math.max(...boxes.map(right)) - x, height: Math.max(...boxes.map(bottom)) - y }
}

const near = (a: Box, b: Box, gap: number) =>
  a.x <= right(b) + gap && b.x <= right(a) + gap && a.y <= bottom(b) + gap && b.y <= bottom(a) + gap

const overlapsX = (a: Box, b: Box) => a.x < right(b) && b.x < right(a)

function inside(inner: Box, outer: Box): boolean {
  const cx = inner.x + inner.width / 2
  const cy = inner.y + inner.height / 2
  return cx >= outer.x - 1 && cx <= right(outer) + 1 && cy >= outer.y - 1 && cy <= bottom(outer) + 1
}

export function clusters(paths: readonly Box[]): Box[][] {
  const sorted = [...paths].sort((a, b) => a.x - b.x)
  const parent = sorted.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i] as number] as number
      i = parent[i] as number
    }
    return i
  }
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i] as Box
    for (let j = i + 1; j < sorted.length && (sorted[j] as Box).x <= right(a) + CLUSTER_GAP; j++)
      if (near(a, sorted[j] as Box, CLUSTER_GAP)) parent[find(j)] = find(i)
  }
  const groups = new Map<number, Box[]>()
  sorted.forEach((b, i) => {
    const root = find(i)
    groups.set(root, [...(groups.get(root) ?? []), b])
  })
  return [...groups.values()]
}

function behindText(area: Box, lines: readonly PdfLine[], kinds: ReadonlyMap<string, StyleKind>): boolean {
  let all = 0
  let text = 0
  for (const line of lines) {
    const chars = charCount(line.text)
    all += chars
    const kind = kinds.get(line.style) ?? 'body'
    if (kind === 'code' || (kind === 'body' && line.width > area.width * TEXT_WIDTH_SHARE)) text += chars
  }
  return all > 0 && text / all > 0.5
}

export function joinProse(texts: readonly string[]): string {
  let out = ''
  for (const raw of texts) {
    const t = raw.replace(/\s+/g, ' ').trim()
    if (!t) continue
    if (/\p{L}-$/u.test(out) && /^\p{Ll}/u.test(t)) out = out.slice(0, -1) + t
    else out = out ? `${out} ${t}` : t
  }
  return out
}

const altOf = (lines: readonly PdfLine[], page: number) =>
  cleanAlt(lines.map((l) => l.text).join(' ')).slice(0, ALT_MAX) || `Figure from page ${page}`

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

function lineGap(lines: readonly PdfLine[], body: BodyStyle): number {
  const gaps: number[] = []
  for (let i = 1; i < lines.length; i++) {
    const [a, b] = [lines[i - 1] as PdfLine, lines[i] as PdfLine]
    if (a.style === body.style && b.style === body.style && b.y > a.y) gaps.push(b.y - a.y)
  }
  return median(gaps) || body.size * 1.2
}

const mathShare = (line: PdfLine) => {
  const all = line.runs.reduce((n, r) => n + charCount(r.text), 0)
  const math = line.runs.reduce((n, r) => n + (r.math ? charCount(r.text) : 0), 0)
  return all ? math / all : 0
}

function equations(lines: readonly PdfLine[], body: BodyStyle, gap: number): PdfLine[][] {
  const found: PdfLine[][] = []
  for (let i = 0; i < lines.length; i++) {
    if (mathShare(lines[i] as PdfLine) < MATH_SHARE) continue
    let end = i
    while (end + 1 < lines.length && mathShare(lines[end + 1] as PdfLine) >= MATH_SHARE) end++
    const group = lines.slice(i, end + 1)
    const before = lines[i - 1]
    const after = lines[end + 1]
    const first = group[0] as PdfLine
    const last = group.at(-1) as PdfLine
    const spaced = (!before || first.y - before.y > gap * 1.15) && (!after || after.y - last.y > gap * 1.15)
    const around = [before, after].filter((l): l is PdfLine => !!l)
    const area = union(group.map(lineBox))
    let apart = !around.length
    if (around.length) {
      const left = Math.min(...around.map((l) => l.x))
      const span = Math.max(...around.map((l) => l.x + l.width)) - left
      const centre = left + span / 2
      const indented = area.x - left > body.size
      const centred = Math.abs(area.x + area.width / 2 - centre) < span * 0.1 && area.width < span * 0.8
      apart = indented || centred
    }
    if (spaced && apart) found.push(group)
    i = end
  }
  return found
}

interface Found {
  box: Box
  kind: Region['kind']
  lines: PdfLine[]
}

function findDrawings(page: PdfPage, lines: readonly PdfLine[], kinds: ReadonlyMap<string, StyleKind>): Found[] {
  const area = page.width * page.height
  const found: Found[] = page.images
    .filter((b) => b.width >= IMAGE_MIN_SIDE && b.height >= IMAGE_MIN_SIDE)
    .map((box) => ({ box, kind: 'image', lines: [] }))
  const paths = page.paths.filter((b) => b.width * b.height < area * PAGE_BACKGROUND)
  for (const group of clusters(paths)) {
    const box = union(group)
    const image = found.find((f) => near(f.box, box, 0))
    if (image) {
      image.box = union([image.box, box])
      continue
    }
    const rule = group.length === 1 && Math.min(box.width, box.height) < RULE_MAX
    if (
      rule ||
      box.width < FIGURE_MIN_SIDE ||
      box.height < FIGURE_MIN_SIDE ||
      box.width * box.height < area * FIGURE_MIN_AREA
    )
      continue
    const within = lines.filter((l) => inside(lineBox(l), box))
    if (behindText(box, within, kinds)) continue
    found.push({ box, kind: 'figure', lines: [] })
  }
  return found
}

export function pageRegions(
  page: PdfPage,
  lines: readonly PdfLine[],
  kinds: ReadonlyMap<string, StyleKind>,
  body: BodyStyle,
): { items: PageItem[]; regions: Region[] } {
  const found = findDrawings(page, lines, kinds)
  const used = new Set<PdfLine>()
  for (const f of found) {
    if (f.kind === 'figure') {
      const labels = lines.filter(
        (l) =>
          !used.has(l) &&
          !inside(lineBox(l), f.box) &&
          near(lineBox(l), f.box, CLUSTER_GAP) &&
          l.style !== body.style &&
          (kinds.get(l.style) ?? 'body') === 'body' &&
          l.width <= f.box.width &&
          !CAPTION.test(l.text.trim()),
      )
      if (labels.length) f.box = union([f.box, ...labels.map(lineBox)])
    }
    f.lines = lines.filter((l) => !used.has(l) && inside(lineBox(l), f.box))
    for (const l of f.lines) used.add(l)
  }
  const gap = lineGap(lines, body)
  const free = lines.filter((l) => !used.has(l))
  for (const group of equations(free, body, gap)) {
    for (const l of group) used.add(l)
    found.push({ box: union(group.map(lineBox)), kind: 'equation', lines: group })
  }

  found.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x)
  const regions = found.map((f, i): Region => {
    const caption = f.kind === 'equation' ? null : findCaption(f.box, lines, used, gap)
    return {
      page: page.number,
      n: i + 1,
      key: `pdf:${page.number}:${i + 1}`,
      box: f.box,
      kind: f.kind,
      alt: altOf(f.lines, page.number),
      caption,
    }
  })
  return { items: placeRegions(lines, used, regions), regions }
}

function placeRegions(lines: readonly PdfLine[], used: ReadonlySet<PdfLine>, regions: readonly Region[]): PageItem[] {
  const items: PageItem[] = lines.filter((l) => !used.has(l)).map((line) => ({ line }))
  for (const region of regions) {
    const at = items.findIndex(
      (it) => 'line' in it && lineBox(it.line).y >= region.box.y && overlapsX(lineBox(it.line), region.box),
    )
    if (at >= 0) {
      items.splice(at, 0, { region })
      continue
    }
    const before = items.findLastIndex(
      (it) => 'line' in it && it.line.y <= region.box.y && overlapsX(lineBox(it.line), region.box),
    )
    items.splice(before >= 0 ? before + 1 : items.length, 0, { region })
  }
  return items
}

function findCaption(box: Box, lines: readonly PdfLine[], used: Set<PdfLine>, gap: number): string | null {
  const free = lines.filter((l) => !used.has(l) && overlapsX(lineBox(l), box))
  const below = free.filter((l) => lineBox(l).y >= bottom(box) - 1).sort((a, b) => a.y - b.y)
  const above = free.filter((l) => bottom(lineBox(l)) <= box.y + 1).sort((a, b) => b.y - a.y)
  const start = [below, above]
    .map((side) => side.slice(0, CAPTION_REACH).find((l) => CAPTION.test(l.text.trim())))
    .find(Boolean)
  if (!start) return null
  const caption = [start]
  for (let i = lines.indexOf(start) + 1; i < lines.length; i++) {
    const next = lines[i] as PdfLine
    const previous = caption.at(-1) as PdfLine
    if (used.has(next) || next.page !== start.page || next.style !== start.style) break
    if (next.y <= previous.y || next.y - previous.y > gap * PARAGRAPH_GAP) break
    caption.push(next)
  }
  for (const l of caption) used.add(l)
  return joinProse(caption.map((l) => l.text))
}
