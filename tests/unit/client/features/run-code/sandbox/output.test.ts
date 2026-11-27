import { describe, expect, it } from 'vitest'
import {
  appendOutput,
  cut,
  EMPTY_OUTPUT,
  MAX_LINE_CHARS,
  MAX_OUTPUT_CHARS,
  MAX_OUTPUT_ENTRIES,
  MAX_TABLE_COLUMNS,
  MAX_TABLE_ROWS,
} from '~/client/features/run-code/sandbox/output'
import type { OutputEntry } from '~/client/features/run-code/sandbox/protocol'

const log = (text: string): OutputEntry => ({ t: 'line', level: 'log', text, indent: 0 })

describe('appendOutput', () => {
  it('adds lines and tables, and a clear empties what is shown but still counts', () => {
    let out = appendOutput(EMPTY_OUTPUT, [log('a'), log('b')])
    expect(out.shown.map((e) => e.t === 'line' && e.text)).toEqual(['a', 'b'])
    out = appendOutput(out, [{ t: 'clear' }, log('c')])
    expect(out).toEqual({
      shown: [{ t: 'line', level: 'log', text: 'c', indent: 0 }],
      count: 4,
      chars: 3,
      capped: false,
    })
    expect(appendOutput(out, [])).toBe(out)
    out = appendOutput(out, [{ t: 'table', columns: ['k', 'v'], rows: [['a', '1']] }])
    expect(out.shown.at(-1)).toEqual({
      t: 'table',
      columns: ['k', 'v'],
      rows: [['a', '1']],
      hiddenRows: 0,
      hiddenColumns: 0,
    })
    expect(out.chars).toBe(7)
  })

  it('keeps 1,000 entries and caps at the next', () => {
    const lines = Array.from({ length: MAX_OUTPUT_ENTRIES }, () => log('x'))
    const full = appendOutput(EMPTY_OUTPUT, lines)
    expect([full.shown.length, full.capped]).toEqual([1000, false])
    const over = appendOutput(full, [log('y')])
    expect([over.shown.length, over.capped]).toEqual([1000, true])
    expect(appendOutput(over, [log('z')])).toBe(over)
  })

  it('keeps 100,000 characters, the last line cut to fit', () => {
    const tenThousand = 'x'.repeat(MAX_LINE_CHARS)
    const lines = Array.from({ length: 10 }, () => log(tenThousand))
    const full = appendOutput(EMPTY_OUTPUT, lines)
    expect([full.chars, full.capped]).toEqual([MAX_OUTPUT_CHARS, false])
    const over = appendOutput(full, [log('y')])
    expect([over.shown.length, over.capped]).toEqual([10, true])
    const nearly = appendOutput(EMPTY_OUTPUT, [...lines.slice(1), log('x'.repeat(MAX_LINE_CHARS - 5))])
    expect(nearly.chars).toBe(MAX_OUTPUT_CHARS - 5)
    const cutOff = appendOutput(nearly, [log('0123456789')])
    expect(cutOff.capped).toBe(true)
    expect(cutOff.shown.at(-1)).toMatchObject({ text: '01234…' })
    const table = appendOutput(nearly, [{ t: 'table', columns: ['a'], rows: [['0123456789']] }])
    expect([table.shown.length, table.capped]).toEqual([10, true])
  })

  it('cuts a line at 10,000 characters and a table at 200 rows and 50 columns', () => {
    const long = appendOutput(EMPTY_OUTPUT, [log('x'.repeat(MAX_LINE_CHARS + 1))])
    expect(long.shown[0]).toMatchObject({ text: `${'x'.repeat(MAX_LINE_CHARS)}…` })
    const row = Array.from({ length: MAX_TABLE_COLUMNS + 2 }, (_, i) => String(i))
    const rows = Array.from({ length: MAX_TABLE_ROWS + 3 }, () => row)
    const shown = appendOutput(EMPTY_OUTPUT, [{ t: 'table', columns: ['a'], rows }]).shown[0]
    expect(
      shown?.t === 'table' && [shown.rows.length, shown.rows[0]?.length, shown.hiddenRows, shown.hiddenColumns],
    ).toEqual([200, 50, 3, 2])
  })

  it('cuts text with an ellipsis only when it is too long', () => {
    expect(cut('abc', 3)).toBe('abc')
    expect(cut('abcd', 3)).toBe('abc…')
  })
})
