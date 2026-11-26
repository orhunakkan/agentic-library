import type { OutputEntry, OutputLevel } from './protocol'

export const MAX_OUTPUT_ENTRIES = 1_000
export const MAX_OUTPUT_CHARS = 100_000
export const MAX_LINE_CHARS = 10_000
export const MAX_TABLE_ROWS = 200
export const MAX_TABLE_COLUMNS = 50

export type ShownEntry =
  | { t: 'line'; level: OutputLevel; text: string; indent: number }
  | { t: 'table'; columns: string[]; rows: string[][]; hiddenRows: number; hiddenColumns: number }

export interface Output {
  shown: ShownEntry[]
  count: number
  chars: number
  capped: boolean
}

export const EMPTY_OUTPUT: Output = { shown: [], count: 0, chars: 0, capped: false }

export function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

const charsOf = (entry: ShownEntry): number =>
  entry.t === 'line'
    ? entry.text.length
    : entry.columns.reduce((n, c) => n + c.length, 0) +
      entry.rows.reduce((n, row) => n + row.reduce((m, c) => m + c.length, 0), 0)

function shownOf(entry: Exclude<OutputEntry, { t: 'clear' }>): ShownEntry {
  if (entry.t === 'line') return { ...entry, text: cut(entry.text, MAX_LINE_CHARS) }
  const width = Math.max(entry.columns.length, ...entry.rows.map((r) => r.length))
  const cells = (row: string[]) => row.slice(0, MAX_TABLE_COLUMNS).map((c) => cut(c, MAX_LINE_CHARS))
  return {
    t: 'table',
    columns: cells(entry.columns),
    rows: entry.rows.slice(0, MAX_TABLE_ROWS).map(cells),
    hiddenRows: Math.max(0, entry.rows.length - MAX_TABLE_ROWS),
    hiddenColumns: Math.max(0, width - MAX_TABLE_COLUMNS),
  }
}

export function appendOutput(state: Output, entries: readonly OutputEntry[]): Output {
  if (state.capped || entries.length === 0) return state
  let { count, chars } = state
  let shown = [...state.shown]
  let capped = false
  for (const entry of entries) {
    if (count >= MAX_OUTPUT_ENTRIES) {
      capped = true
      break
    }
    count++
    if (entry.t === 'clear') {
      shown = []
      continue
    }
    const next = shownOf(entry)
    const size = charsOf(next)
    const room = MAX_OUTPUT_CHARS - chars
    if (size > room) {
      if (next.t === 'line' && room > 0) shown.push({ ...next, text: cut(next.text, room) })
      chars = MAX_OUTPUT_CHARS
      capped = true
      break
    }
    chars += size
    shown.push(next)
  }
  return { shown, count, chars, capped }
}
