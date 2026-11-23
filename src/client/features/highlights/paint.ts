import { HIGHLIGHT_COLORS } from '~/shared/highlights/colors'
import type { HighlightView } from '~/shared/highlights/group'
import { type PageText, rangeFor } from './dom-text'

const NAMES = [...HIGHLIGHT_COLORS.map((c) => `hl-${c}`), 'hl-note', 'hl-active', 'hl-flash']

function canPaint(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight === 'function'
}

export function clearPaint(): void {
  if (!canPaint()) return
  for (const name of NAMES) CSS.highlights.delete(name)
}

export interface Paintable extends Pick<HighlightView, 'color' | 'note' | 'place' | 'createdAt'> {
  key: string
}

export function paintPages(
  pages: readonly { page: PageText; items: readonly Paintable[] }[],
  active: string | null,
  flash: string | null,
): { key: string; range: Range }[] {
  const ranges: PaintedRange[] = []
  for (const { page, items } of pages) {
    for (const item of items) {
      const range = item.place && rangeFor(page, item.place.start, item.place.end)
      if (range) ranges.push({ key: item.key, range, item })
    }
  }
  ranges.sort((a, b) => b.item.createdAt.localeCompare(a.item.createdAt))
  paint(ranges, active, flash)
  return ranges.map(({ key, range }) => ({ key, range }))
}

interface PaintedRange {
  key: string
  range: Range
  item: Paintable
}

function paint(ranges: readonly PaintedRange[], active: string | null, flash: string | null): void {
  if (!canPaint()) return
  clearPaint()
  const byColour = new Map<string, Highlight>()
  let rank = 0
  for (const { range, item } of [...ranges].reverse()) {
    const name = `hl-${item.color}`
    let highlight = byColour.get(name)
    if (!highlight) {
      highlight = new Highlight()
      byColour.set(name, highlight)
    }
    highlight.add(range)
    highlight.priority = ++rank
  }
  for (const [name, highlight] of byColour) CSS.highlights.set(name, highlight)
  const extra = (name: string, keep: (key: string, item: Paintable) => boolean, priority: number) => {
    const picked = ranges.filter((r) => keep(r.key, r.item)).map((r) => r.range)
    if (!picked.length) return
    const highlight = new Highlight(...picked)
    highlight.priority = priority
    CSS.highlights.set(name, highlight)
  }
  extra('hl-note', (_key, item) => item.note !== null, rank + 1)
  extra('hl-active', (key) => key === active, rank + 2)
  extra('hl-flash', (key) => key === flash, rank + 3)
}

export function hitTest(ranges: readonly { key: string; range: Range }[], x: number, y: number): string | null {
  for (const { key, range } of ranges) {
    for (const rect of range.getClientRects()) {
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return key
    }
  }
  return null
}

const SPEAKING = 'ra-sentence'
const SPEAKING_PRIORITY = 1000

function paintMark(name: string, priority: number, range: Range | null): void {
  if (!canPaint()) return
  if (!range) {
    CSS.highlights.delete(name)
    return
  }
  const highlight = new Highlight(range)
  highlight.priority = priority
  CSS.highlights.set(name, highlight)
}

export function paintSpeaking(range: Range | null): void {
  paintMark(SPEAKING, SPEAKING_PRIORITY, range)
}

const SPEAKING_WORD = 'ra-word'
const WORD_PRIORITY = 1001

export function paintWord(range: Range | null): void {
  paintMark(SPEAKING_WORD, WORD_PRIORITY, range)
}
