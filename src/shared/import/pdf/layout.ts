import {
  type BookBlock,
  type DraftChapter,
  type InlineStyle,
  LIST_DEPTH_MAX,
  type ListBlock,
  type ListItem,
  type Run,
} from '../blocks.ts'
import { readingOrder } from './columns.ts'
import { pageLines, removeFurniture } from './lines.ts'
import { pageRegions } from './regions.ts'
import { type BodyStyle, bodyStyle, styleKinds, styleTable } from './styles.ts'
import type {
  LineRun,
  PdfLayoutReport,
  PdfLine,
  PdfOutlineEntry,
  PdfOverrides,
  PdfPage,
  PdfStyle,
  Region,
  StyleKind,
} from './types.ts'

export const PARAGRAPH_GAP = 1.4
export const INDENT = 0.8
export const SHORT_LINE = 0.75
export const HANGING_SLACK = 2
export const FRONT_MATTER = 'Front matter'
export const NOTES = 'Notes'

export interface PdfLayout {
  chapters: DraftChapter[]
  regions: Region[]
  styles: PdfStyle[]
  report: PdfLayoutReport
}

interface Frame {
  left: number
  width: number
  gap: number
}

interface Entry {
  line: PdfLine
  kind: StyleKind
  frame: Frame
}

type Item = { entry: Entry } | { region: Region; index: number }

type Element =
  | { type: 'title'; text: string; page: number; y: number }
  | { type: 'block'; block: BookBlock; page: number; y: number }
  | { type: 'note'; runs: TextRun[]; page: number; y: number }

type TextRun = Exclude<Run, { br: true }>

const BULLET = /^\s*([•◦▪‣∙●○■□–*])(\s+|$)/u
const NUMBERED = /^\s*(\d{1,3}[.)]|[a-z][.)]|\((?:[ivxlc]{1,6}|\d{1,3}|[a-z])\))(\s+|$)/
const ENDS_SENTENCE = /([.?!:]|["”’»])\s*$/u
const NOTE_MARKER = /^\s*(\d{1,3}|[*†‡§¶]{1,3}|[a-z])(?=\s|$)/u

const isHeading = (kind: StyleKind): kind is 'chapter' | 'h3' | 'h4' =>
  kind === 'chapter' || kind === 'h3' || kind === 'h4'

function median(values: readonly number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) / 2)] as number
}

function mode(values: readonly number[]): number | null {
  const counts = new Map<number, number>()
  for (const v of values) {
    const rounded = Math.round(v * 2) / 2
    counts.set(rounded, (counts.get(rounded) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null
}

function pageFrames(
  lines: readonly PdfLine[],
  page: PdfPage,
  columns: number,
  body: BodyStyle,
): (line: PdfLine) => Frame {
  const middle = page.width / 2
  const side = (line: PdfLine) => {
    if (columns < 2) return 0
    if (line.x < middle && line.x + line.width > middle) return 2
    return line.x + line.width / 2 > middle ? 1 : 0
  }
  const frames = [0, 1, 2].map((s): Frame => {
    const own = lines.filter((l) => side(l) === s && (s === 2 || l.style === body.style))
    const left = mode(own.map((l) => l.x)) ?? Math.min(...lines.map((l) => l.x), page.width)
    const right = Math.max(...own.map((l) => l.x + l.width), left + body.size)
    const gaps = own.slice(1).flatMap((l, i) => {
      const gap = l.y - (own[i] as PdfLine).y
      return gap > 0 && gap < body.size * 3 ? [gap] : []
    })
    return { left, width: right - left, gap: median(gaps) ?? body.size * 1.2 }
  })
  return (line) => frames[side(line)] as Frame
}

function lineRuns(line: PdfLine, code = false): TextRun[] {
  const baseFont = line.runs.find((r) => r.style === line.style)?.font
  return line.runs.map((r) => {
    const style = runStyle(r, baseFont, code)
    return style ? { text: r.text, style } : { text: r.text }
  })
}

function runStyle(r: LineRun, baseFont: string | undefined, code: boolean): InlineStyle | undefined {
  if (r.sup) return 'sup'
  if (code) return undefined
  if (r.mono && r.font !== baseFont) return 'code'
  if (r.font === baseFont) return undefined
  if (r.bold) return 'strong'
  if (r.italic) return 'em'
  return undefined
}

function joinRuns(into: TextRun[], next: readonly TextRun[]): void {
  const last = into.at(-1)
  const first = next[0]
  if (last && first) {
    if (last.style !== 'code' && /\p{L}-$/u.test(last.text) && /^\p{Ll}/u.test(first.text))
      last.text = last.text.slice(0, -1)
    else into.push({ text: ' ' })
  }
  into.push(...next)
}

function tidy(runs: readonly TextRun[]): TextRun[] {
  const split: TextRun[] = []
  for (const r of runs) {
    const text = r.style === 'code' ? r.text : r.text.replace(/\s+/g, ' ')
    if (!r.style) {
      split.push({ text })
      continue
    }
    const [, lead = '', inner = '', trail = ''] = /^(\s*)(.*?)(\s*)$/su.exec(text) ?? []
    if (lead) split.push({ text: ' ' })
    if (inner) split.push({ text: inner, style: r.style })
    if (trail) split.push({ text: ' ' })
  }
  const merged: TextRun[] = []
  for (const r of split) {
    const last = merged.at(-1)
    if (last && last.style === r.style) {
      last.text = r.style ? last.text + r.text : (last.text + r.text).replace(/ {2,}/g, ' ')
    } else merged.push({ ...r })
  }
  const first = merged[0]
  if (first && !first.style) first.text = first.text.trimStart()
  const end = merged.at(-1)
  if (end && !end.style) end.text = end.text.trimEnd()
  return merged.filter((r) => r.text)
}

const runsText = (runs: readonly TextRun[]) =>
  runs
    .map((r) => r.text)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()

function dropLeading(runs: readonly TextRun[], count: number): TextRun[] {
  let left = count
  const out: TextRun[] = []
  for (const r of runs) {
    if (left > 0) {
      const take = Math.min(left, r.text.length)
      left -= take
      const rest = r.text.slice(take)
      if (rest) out.push({ ...r, text: rest })
    } else out.push(r)
  }
  return out
}

function codeText(entries: readonly Entry[]): string {
  const runs = entries.flatMap((e) => e.line.runs).filter((r) => r.text.trim().length > 1)
  const charWidth = median(runs.map((r) => r.width / r.text.length)) ?? 5
  const left = Math.min(...entries.map((e) => e.line.x))
  const gaps = entries.slice(1).flatMap((e, i) => {
    const before = (entries[i] as Entry).line
    return e.line.page === before.page && e.line.y > before.y ? [e.line.y - before.y] : []
  })
  const leading = median(gaps) ?? 0
  const lines: string[] = []
  let previous: PdfLine | undefined
  for (const { line } of entries) {
    if (previous && leading && line.page === previous.page) {
      const blanks = Math.round((line.y - previous.y) / leading) - 1
      for (let i = 0; i < Math.min(blanks, 3); i++) lines.push('')
    }
    let text = ''
    for (const r of line.runs) {
      const column = Math.max(0, Math.round((r.x - left) / charWidth))
      if (column > text.length) text += ' '.repeat(column - text.length)
      else if (text && !/\s$/.test(text) && !/^\s/.test(r.text)) text += ' '
      text += r.text
    }
    lines.push(text.trimEnd())
    previous = line
  }
  return lines.join('\n')
}

interface ItemStart {
  ordered: boolean
  length: number
  markerX: number
  textX: number
}

function itemStart(line: PdfLine): ItemStart | null {
  const match = BULLET.exec(line.text) ?? NUMBERED.exec(line.text)
  if (!match) return null
  const ordered = !BULLET.test(line.text)
  const length = match[0].length
  const first = line.runs[0] as LineRun
  const after = first.text.trim().length <= match[0].trim().length ? line.runs[1] : undefined
  const textX = after ? after.x : first.x + (first.width * length) / Math.max(first.text.length, 1)
  if (!line.text.slice(length).trim()) return null
  return { ordered, length, markerX: line.x, textX }
}

interface OpenList {
  block: ListBlock
  markerX: number
  textX: number
}

interface Walk {
  elements: Element[]
  notes: Element[]
}

function footnoteLines(entries: readonly Entry[], body: BodyStyle): Set<PdfLine> {
  const notes = new Set<PdfLine>()
  const bodyBottom = Math.max(...entries.filter((e) => e.line.style === body.style).map((e) => e.line.y), 0)
  const markers = new Set(
    entries.flatMap((e) => e.line.runs.filter((r) => r.sup).map((r) => r.text.trim())).filter(Boolean),
  )
  if (!markers.size) return notes
  let open: PdfLine | null = null
  for (const { line, kind } of entries) {
    const below = line.y > bodyBottom && line.size < body.size - 0.25 && kind !== 'drop'
    const marker = NOTE_MARKER.exec(line.text)?.[1]
    if (below && marker && markers.has(marker)) {
      notes.add(line)
      open = line
    } else if (below && open && line.style === open.style) notes.add(line)
    else open = null
  }
  return notes
}

function walk(items: readonly Item[], notesOf: ReadonlySet<PdfLine>): Walk {
  const elements: Element[] = []
  const notes: Element[] = []
  let paragraph: { entries: Entry[]; runs: TextRun[] } | null = null
  let code: Entry[] = []
  let lists: OpenList[] = []
  let heading: { entry: Entry; text: string[] } | null = null
  let note: { entry: Entry; runs: TextRun[] } | null = null
  let waiting: Element[] = []

  const at = (entry: Entry) => ({ page: entry.line.page, y: entry.line.y })
  const flushParagraph = () => {
    if (paragraph) {
      const runs = tidy(paragraph.runs)
      const first = paragraph.entries[0] as Entry
      if (runsText(runs)) elements.push({ type: 'block', block: { type: 'paragraph', runs }, ...at(first) })
      paragraph = null
    }
    elements.push(...waiting)
    waiting = []
  }
  const flushCode = () => {
    const first = code[0]
    if (first) {
      const text = codeText(code)
      if (text.trim()) elements.push({ type: 'block', block: { type: 'code', text }, ...at(first) })
    }
    code = []
  }
  const flushLists = () => {
    lists = []
  }
  const flushHeading = () => {
    if (!heading) return
    const text = heading.text.join(' ').replace(/\s+/g, ' ').trim()
    const { entry } = heading
    heading = null
    if (!text) return
    if (entry.kind === 'chapter') elements.push({ type: 'title', text, ...at(entry) })
    else
      elements.push({
        type: 'block',
        block: { type: 'heading', level: entry.kind === 'h3' ? 3 : 4, runs: [{ text }] },
        ...at(entry),
      })
  }
  const flushNote = () => {
    if (note) {
      notes.push({ type: 'note', runs: tidy(note.runs), ...at(note.entry) })
      note = null
    }
  }
  const flushAll = () => {
    flushHeading()
    flushParagraph()
    flushCode()
    flushLists()
  }

  const opensItem = (start: ItemStart | null, index: number, page: number) => {
    if (!start) return false
    if (lists.some((l) => Math.abs(l.markerX - start.markerX) <= HANGING_SLACK)) return true
    const next = items.slice(index + 1).find((i) => 'entry' in i)
    if (!next || !('entry' in next)) return false
    const line = next.entry.line
    if (next.entry.kind !== 'body' || line.page !== page) return false
    return Math.abs(line.x - start.textX) <= HANGING_SLACK || itemStart(line) !== null
  }

  for (let index = 0; index < items.length; index++) {
    const item = items[index] as Item
    if ('region' in item) {
      const { region } = item
      const block: BookBlock = {
        type: 'image',
        image: item.index + 1,
        alt: region.alt,
        ...(region.caption ? { caption: [{ text: region.caption }] } : {}),
      }
      const element: Element = { type: 'block', block, page: region.page, y: region.box.y }
      flushHeading()
      flushCode()
      flushLists()
      if (paragraph) waiting.push(element)
      else elements.push(element)
      continue
    }
    const { entry } = item
    const { line, kind } = entry
    if (kind === 'drop') continue

    if (notesOf.has(line)) {
      const marker = NOTE_MARKER.exec(line.text)
      if (marker) {
        flushNote()
        const rest = lineRuns(line)
        note = {
          entry,
          runs: [
            { text: (marker[1] as string).trim(), style: 'sup' },
            { text: ' ' },
            ...dropLeading(rest, marker[0].length),
          ],
        }
      } else if (note) joinRuns(note.runs, lineRuns(line))
      continue
    }
    flushNote()

    if (isHeading(kind)) {
      const last = heading?.entry.line
      if (
        heading &&
        last &&
        heading.entry.kind === kind &&
        last.style === line.style &&
        last.page === line.page &&
        line.y - last.y < line.size * 1.8
      ) {
        heading.text.push(line.text)
        continue
      }
      flushAll()
      heading = { entry, text: [line.text] }
      continue
    }
    flushHeading()

    if (kind === 'code') {
      flushParagraph()
      flushLists()
      code.push(entry)
      continue
    }
    flushCode()

    const start = itemStart(line)
    if (start && opensItem(start, index, line.page)) {
      flushParagraph()
      while (lists.length && (lists.at(-1) as OpenList).markerX > start.markerX + HANGING_SLACK) lists.pop()
      const current = lists.at(-1)
      const runs = tidy(dropLeading(lineRuns(line), start.length))
      const listItem: ListItem = { runs }
      if (
        current &&
        Math.abs(current.markerX - start.markerX) <= HANGING_SLACK &&
        current.block.ordered === start.ordered
      ) {
        current.block.items.push(listItem)
        current.textX = start.textX
      } else if (current && start.markerX > current.markerX + HANGING_SLACK && lists.length < LIST_DEPTH_MAX) {
        const nested: ListBlock = { type: 'list', ordered: start.ordered, items: [listItem] }
        const parent = current.block.items.at(-1) as ListItem
        parent.lists = [...(parent.lists ?? []), nested]
        lists.push({ block: nested, markerX: start.markerX, textX: start.textX })
      } else {
        flushLists()
        const block: ListBlock = { type: 'list', ordered: start.ordered, items: [listItem] }
        lists = [{ block, markerX: start.markerX, textX: start.textX }]
        elements.push({ type: 'block', block, ...at(entry) })
      }
      continue
    }
    const openList = lists.at(-1)
    if (openList && Math.abs(line.x - openList.textX) <= HANGING_SLACK) {
      const last = openList.block.items.at(-1) as ListItem
      const joined = [...(last.runs as TextRun[])]
      joinRuns(joined, lineRuns(line))
      last.runs = tidy(joined)
      continue
    }
    flushLists()

    if (paragraph && continuesParagraph(paragraph.entries.at(-1) as Entry, entry)) {
      joinRuns(paragraph.runs, lineRuns(line))
      paragraph.entries.push(entry)
      continue
    }
    flushParagraph()
    paragraph = { entries: [entry], runs: lineRuns(line) }
  }
  flushNote()
  flushHeading()
  flushParagraph()
  flushCode()
  return { elements, notes }
}

function continuesParagraph(previous: Entry, next: Entry): boolean {
  const p = previous.line
  const l = next.line
  if (p.style !== l.style) return false
  const { frame } = next
  if (l.x - frame.left > INDENT * l.size) return false
  const short = p.x + p.width - previous.frame.left < SHORT_LINE * previous.frame.width
  if (short && ENDS_SENTENCE.test(p.text)) return false
  const sameFrame = p.page === l.page && previous.frame === frame && l.y > p.y
  if (sameFrame && l.y - p.y > PARAGRAPH_GAP * frame.gap) return false
  return true
}

const normal = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

function usableOutline(outline: readonly PdfOutlineEntry[], pages: readonly PdfPage[]): PdfOutlineEntry[] {
  const numbers = new Set(pages.map((p) => p.number))
  const entries = outline
    .filter((e) => numbers.has(e.page) && e.title.trim())
    .sort((a, b) => a.page - b.page || a.y - b.y)
  return entries.length >= 2 ? entries : []
}

function withNotes(blocks: BookBlock[], notes: readonly Element[]): BookBlock[] {
  if (!notes.length) return blocks
  return [
    ...blocks,
    { type: 'heading', level: 4, runs: [{ text: NOTES }] },
    ...notes.flatMap((n): BookBlock[] => (n.type === 'note' ? [{ type: 'paragraph', runs: n.runs }] : [])),
  ]
}

const before = (a: { page: number; y: number }, b: { page: number; y: number }) =>
  a.page < b.page || (a.page === b.page && a.y < b.y)

function byOutline(
  elements: readonly Element[],
  notes: readonly Element[],
  entries: readonly PdfOutlineEntry[],
): DraftChapter[] {
  const starts = entries.map((e) => ({ title: e.title.trim(), page: e.page, y: e.y - 2 }))
  const chapterOf = (at: { page: number; y: number }) => {
    let n = -1
    for (let i = 0; i < starts.length; i++) if (!before(at, starts[i] as { page: number; y: number })) n = i
    return n
  }
  const chapters: { title: string; blocks: BookBlock[]; notes: Element[] }[] = [
    { title: FRONT_MATTER, blocks: [], notes: [] },
    ...starts.map((s) => ({ title: s.title, blocks: [] as BookBlock[], notes: [] as Element[] })),
  ]
  for (const element of elements) {
    const chapter = chapters[chapterOf(element) + 1] as (typeof chapters)[number]
    if (element.type === 'title') {
      if (!chapter.blocks.length && normal(element.text) === normal(chapter.title)) continue
      chapter.blocks.push({ type: 'heading', level: 3, runs: [{ text: element.text }] })
    } else if (element.type === 'block') chapter.blocks.push(element.block)
  }
  for (const note of notes) chapters[chapterOf(note) + 1]?.notes.push(note)
  return chapters.map((c) => ({ title: c.title, blocks: withNotes(c.blocks, c.notes) })).filter((c) => c.blocks.length)
}

function byHeadings(elements: readonly Element[], notes: readonly Element[], title: string): DraftChapter[] {
  const titles = elements.filter((e) => e.type === 'title')
  if (!titles.length) {
    const blocks = elements.flatMap((e) => (e.type === 'block' ? [e.block] : []))
    return blocks.length ? [{ title, blocks: withNotes(blocks, notes) }] : []
  }
  const chapters: { title: string; blocks: BookBlock[]; notes: Element[]; from: Element | null }[] = [
    { title: FRONT_MATTER, blocks: [], notes: [], from: null },
  ]
  for (const element of elements) {
    if (element.type === 'title') chapters.push({ title: element.text, blocks: [], notes: [], from: element })
    else if (element.type === 'block') (chapters.at(-1) as (typeof chapters)[number]).blocks.push(element.block)
  }
  for (const note of notes) {
    let target = chapters[0] as (typeof chapters)[number]
    for (const c of chapters) if (c.from && !before(note, c.from)) target = c
    target.notes.push(note)
  }
  return chapters.map((c) => ({ title: c.title, blocks: withNotes(c.blocks, c.notes) })).filter((c) => c.blocks.length)
}

function chapterMode(
  entries: readonly PdfOutlineEntry[],
  elements: readonly Element[],
  overrides: PdfOverrides,
): PdfLayoutReport['chapters'] {
  if (entries.length && overrides.chapters !== 'headings') return 'outline'
  return elements.some((e) => e.type === 'title') ? 'headings' : 'single'
}

export function layoutPdf(
  allPages: readonly PdfPage[],
  outline: readonly PdfOutlineEntry[],
  overrides: PdfOverrides = {},
  title = 'Untitled',
): PdfLayout {
  const range = overrides.pages
  const pages = range ? allPages.filter((p) => p.number >= range.first && p.number <= range.last) : [...allPages]

  const built = pages.map(pageLines)
  const furniture = removeFurniture(built, pages)
  const body = bodyStyle(furniture.pages)
  const ordered = furniture.pages.map((lines) => readingOrder(lines, body))
  const styles = styleTable(
    ordered.map((o) => o.lines),
    body,
  )
  const kinds = styleKinds(styles, overrides.styles)

  const regions: Region[] = []
  const items: Item[] = []
  const notes = new Set<PdfLine>()
  pages.forEach((page, i) => {
    const { lines, columns } = ordered[i] as { lines: PdfLine[]; columns: number }
    const found = pageRegions(page, lines, kinds, body)
    const frameOf = pageFrames(lines, page, columns, body)
    const entries: Entry[] = []
    for (const pageItem of found.items) {
      if ('region' in pageItem) {
        items.push({ region: pageItem.region, index: regions.length })
        regions.push(pageItem.region)
      } else {
        const line = pageItem.line
        const entry: Entry = { line, kind: kinds.get(line.style) ?? 'body', frame: frameOf(line) }
        entries.push(entry)
        items.push({ entry })
      }
    }
    for (const note of footnoteLines(entries, body)) notes.add(note)
  })

  const { elements, notes: footnotes } = walk(items, notes)
  const entries = usableOutline(outline, pages)
  const mode = chapterMode(entries, elements, overrides)
  const chapters = mode === 'outline' ? byOutline(elements, footnotes, entries) : byHeadings(elements, footnotes, title)

  return {
    chapters,
    regions,
    styles,
    report: {
      pages: pages.length,
      chapters: mode,
      hasOutline: entries.length > 0,
      twoColumnPages: ordered.filter((o) => o.columns > 1).length,
      furniturePages: furniture.furniturePages,
      pictures: regions.length,
    },
  }
}
