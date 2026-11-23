import { topToBottom } from './lines.ts'
import type { PdfLine } from './types.ts'

export const GUTTER_MIN = 1.5
export const GUTTER_COVER = 0.6
const COLUMN_MIN_LINES = 2
const FOOT_GAP = 2

interface Gutter {
  left: number
  right: number
}

interface Columns {
  gutter: Gutter
  top: number
  height: number
}

const top = (line: PdfLine) => line.y - line.size
const crosses = (line: PdfLine, gutter: Gutter) => line.x < gutter.right && line.x + line.width > gutter.left

function clearStretch(bodyLines: readonly PdfLine[], gutter: Gutter): { top: number; height: number } | null {
  let best: { top: number; height: number } | null = null
  let stretch: PdfLine[] = []
  const close = () => {
    const left = stretch.filter((l) => l.x + l.width <= gutter.left).length
    const right = stretch.filter((l) => l.x >= gutter.right).length
    if (left >= COLUMN_MIN_LINES && right >= COLUMN_MIN_LINES) {
      const from = Math.min(...stretch.map(top))
      const height = Math.max(...stretch.map((l) => l.y)) - from
      if (!best || height > best.height) best = { top: from, height }
    }
    stretch = []
  }
  for (const line of [...bodyLines].sort((a, b) => a.y - b.y)) {
    if (crosses(line, gutter)) close()
    else stretch.push(line)
  }
  close()
  return best
}

function findColumns(lines: readonly PdfLine[], body: { style: string; size: number }): Columns | null {
  const bodyLines = lines.filter((l) => l.style === body.style)
  if (bodyLines.length < 2 * COLUMN_MIN_LINES) return null
  const textHeight = Math.max(...bodyLines.map((l) => l.y)) - Math.min(...bodyLines.map(top))
  let best: Columns | null = null
  for (const right of new Set(bodyLines.map((l) => l.x + l.width))) {
    const starts = bodyLines.filter((l) => l.x >= right + GUTTER_MIN * body.size).map((l) => l.x)
    if (!starts.length) continue
    const gutter = { left: right, right: Math.min(...starts) }
    const stretch = clearStretch(bodyLines, gutter)
    if (!stretch || stretch.height < GUTTER_COVER * textHeight) continue
    const wider =
      best && stretch.height === best.height && gutter.right - gutter.left > best.gutter.right - best.gutter.left
    if (!best || stretch.height > best.height || wider) best = { gutter, ...stretch }
  }
  return best
}

export function readingOrder(
  lines: readonly PdfLine[],
  body: { style: string; size: number },
): { lines: PdfLine[]; columns: number } {
  const columns = findColumns(lines, body)
  if (!columns) return { lines: topToBottom(lines), columns: 1 }
  const { gutter } = columns
  const middle = (gutter.left + gutter.right) / 2
  const foot = columns.top + columns.height + FOOT_GAP * body.size
  const last = (l: PdfLine) => (crosses(l, gutter) ? l.y >= columns.top : l.y > foot)
  const inColumns = lines.filter((l) => !crosses(l, gutter) && !last(l))
  const left = topToBottom(inColumns.filter((l) => l.x + l.width / 2 < middle))
  const right = topToBottom(inColumns.filter((l) => l.x + l.width / 2 >= middle))
  const above = topToBottom(lines.filter((l) => crosses(l, gutter) && !last(l)))
  const below = topToBottom(lines.filter(last))
  return { lines: [...above, ...left, ...right, ...below], columns: 2 }
}
