import { describe, expect, it } from 'vitest'
import { parseFrameMessage } from './protocol'

const line = { t: 'line', level: 'log', text: '100', indent: 0 }

describe('parseFrameMessage', () => {
  it('accepts each kind', () => {
    const messages = [
      { kind: 'ready' },
      { kind: 'loading', id: 'r1', engine: 'python' },
      { kind: 'loading', id: 'r1', engine: 'sqlite' },
      { kind: 'started', id: 'r1' },
      {
        kind: 'output',
        id: 'r1',
        entries: [line, { t: 'table', columns: ['a'], rows: [['1'], ['2']] }, { t: 'clear' }],
      },
      { kind: 'done', id: 'r1', ms: 12 },
      { kind: 'done', id: 'r1', ms: 0, error: { message: 'TypeError: x', line: 2 } },
      { kind: 'done', id: 'r1', ms: 3, error: { message: 'Error' } },
      { kind: 'failed', id: 'r1', reason: 'engine' },
      { kind: 'failed', id: 'r1', reason: 'worker' },
    ]
    for (const message of messages) expect(parseFrameMessage(message)).toEqual(message)
    for (const level of ['info', 'warn', 'error'])
      expect(parseFrameMessage({ kind: 'output', id: 'r', entries: [{ ...line, level }] })).not.toBeNull()
  })

  it('refuses extra fields, wrong types and unknown kinds', () => {
    const refused = [
      null,
      'ready',
      [],
      { kind: 'ready', extra: 1 },
      { kind: 'hello', id: 'r' },
      { kind: 'started' },
      { kind: 'started', id: '' },
      { kind: 'started', id: 1 },
      { kind: 'started', id: 'x'.repeat(65) },
      { kind: 'started', id: 'r', extra: true },
      { kind: 'loading', id: 'r', engine: 'ruby' },
      { kind: 'output', id: 'r', entries: 'text' },
      { kind: 'output', id: 'r', entries: [{ ...line, level: 'debug' }] },
      { kind: 'output', id: 'r', entries: [{ ...line, indent: -1 }] },
      { kind: 'output', id: 'r', entries: [{ ...line, indent: 1.5 }] },
      { kind: 'output', id: 'r', entries: [{ ...line, html: '<b>' }] },
      { kind: 'output', id: 'r', entries: [{ t: 'html', text: '<b>' }] },
      { kind: 'output', id: 'r', entries: [{ t: 'clear', all: true }] },
      { kind: 'output', id: 'r', entries: [{ t: 'table', columns: [1], rows: [] }] },
      { kind: 'output', id: 'r', entries: [{ t: 'table', columns: ['a'], rows: [[{}]] }] },
      { kind: 'output', id: 'r', entries: [{ t: 'table', columns: ['a'], rows: 'x' }] },
      { kind: 'output', id: 'r', entries: [null] },
      { kind: 'done', id: 'r' },
      { kind: 'done', id: 'r', ms: -1 },
      { kind: 'done', id: 'r', ms: Number.POSITIVE_INFINITY },
      { kind: 'done', id: 'r', ms: '5' },
      { kind: 'done', id: 'r', ms: 1, error: 'boom' },
      { kind: 'done', id: 'r', ms: 1, error: { message: 'x', line: 0 } },
      { kind: 'done', id: 'r', ms: 1, error: { message: 'x', stack: 'y' } },
      { kind: 'failed', id: 'r', reason: 'other' },
    ]
    for (const message of refused) expect(parseFrameMessage(message)).toBeNull()
  })

  it('refuses over-long text and too many entries, rows or columns', () => {
    const output = (entries: unknown[]) => ({ kind: 'output', id: 'r', entries })
    expect(parseFrameMessage(output([{ ...line, text: 'x'.repeat(20_000) }]))).not.toBeNull()
    expect(parseFrameMessage(output([{ ...line, text: 'x'.repeat(20_001) }]))).toBeNull()
    expect(parseFrameMessage(output(Array.from({ length: 1000 }, () => line)))).not.toBeNull()
    expect(parseFrameMessage(output(Array.from({ length: 1001 }, () => line)))).toBeNull()
    const rows = (n: number) => Array.from({ length: n }, () => ['1'])
    expect(parseFrameMessage(output([{ t: 'table', columns: ['a'], rows: rows(1000) }]))).not.toBeNull()
    expect(parseFrameMessage(output([{ t: 'table', columns: ['a'], rows: rows(1001) }]))).toBeNull()
    const wide = Array.from({ length: 101 }, () => 'c')
    expect(parseFrameMessage(output([{ t: 'table', columns: wide, rows: [] }]))).toBeNull()
    expect(parseFrameMessage({ kind: 'done', id: 'r', ms: 1, error: { message: 'x'.repeat(20_001) } })).toBeNull()
  })
})
