import { describe, expect, it } from 'vitest'
import { parseFileSummary, parseSummary, ratchet, ratchetFiles, type Totals } from './ratchet'

const SUMMARY = `
=============================== Coverage summary ===============================
Statements   : 95.58% ( 7722/8079 )
Branches     : 92.79% ( 5895/6353 )
Functions    : 94.66% ( 1615/1706 )
Lines        : 96.1% ( 7001/7285 )
================================================================================
`

const INLINE = `      thresholds: { statements: 90, branches: 88, functions: 89, lines: 91 },\n`

const PER_FILE = `const FULL = { statements: 100, branches: 100, functions: 100, lines: 100 }
      thresholds: {
        statements: 93,
        branches: 91,
        functions: 93,
        lines: 95,
        // Never below 90% lines and 85% branches.
        'src/server/auth.ts': FULL,
        'src/server/sessions.ts': { statements: 95, branches: 90, functions: 100, lines: 100 },
      },
`

describe('parseSummary', () => {
  it('reads the four percentages of a text summary', () => {
    expect(parseSummary(SUMMARY)).toEqual({ statements: 95.58, branches: 92.79, functions: 94.66, lines: 96.1 })
  })

  it('is null when a metric is missing', () => {
    expect(parseSummary('Statements   : 95.58% ( 7722/8079 )')).toBeNull()
  })
})

describe('ratchet', () => {
  const totals: Totals = { statements: 95.58, branches: 92.79, functions: 94.66, lines: 96.1 }

  it('raises the overall thresholds to the coverage, rounded down, exactly as before, per-file floors aside', () => {
    const { config, raised } = ratchet(PER_FILE, totals)
    expect(raised).toEqual([
      { metric: 'statements', from: 93, to: 95 },
      { metric: 'branches', from: 91, to: 92 },
      { metric: 'functions', from: 93, to: 94 },
      { metric: 'lines', from: 95, to: 96 },
    ])
    expect(config).toBe(
      PER_FILE.replace('statements: 93', 'statements: 95')
        .replace('branches: 91', 'branches: 92')
        .replace('functions: 93,', 'functions: 94,')
        .replace('lines: 95', 'lines: 96'),
    )
    expect(config).toContain("'src/server/sessions.ts': { statements: 95, branches: 90, functions: 100, lines: 100 }")
    expect(config).toContain('const FULL = { statements: 100, branches: 100, functions: 100, lines: 100 }')
  })

  it('never lowers a threshold, and changes nothing when the coverage rounds down to it', () => {
    const { config, raised } = ratchet(INLINE, { statements: 90.9, branches: 80, functions: 89.99, lines: 91 })
    expect(raised).toEqual([])
    expect(config).toBe(INLINE)
  })

  it('raises an inline block in place', () => {
    const { config } = ratchet(INLINE, { statements: 90.51, branches: 89.2, functions: 89.61, lines: 91.45 })
    expect(config).toBe(`      thresholds: { statements: 90, branches: 89, functions: 89, lines: 91 },\n`)
  })

  it('refuses a config without overall thresholds', () => {
    expect(() => ratchet('export default {}', totals)).toThrow(/no `thresholds: \{`/)
    expect(() => ratchet("thresholds: { 'src/a.ts': FULL }", totals)).toThrow(/no overall statements/)
  })
})

const ROOT = '/repo'

/** A json-summary report as Vitest's v8 coverage writes it: absolute paths, a pct per metric, and a total. */
const metric = (pct: number) => ({ total: 10, covered: Math.round(pct / 10), skipped: 0, pct })
const fileRow = (statements: number, branches: number, functions: number, lines: number) => ({
  statements: metric(statements),
  branches: metric(branches),
  functions: metric(functions),
  lines: metric(lines),
})
const JSON_SUMMARY = {
  total: fileRow(95.58, 92.79, 94.66, 96.1),
  '/repo/src/server/auth.ts': fileRow(100, 100, 100, 100),
  '/repo/src/server/sessions.ts': fileRow(98.4, 96.2, 100, 100),
}

describe('parseFileSummary', () => {
  it('reads each file’s four percentages by its path from the repository root, without the total', () => {
    const files = parseFileSummary(JSON_SUMMARY, ROOT)
    expect([...files.keys()]).toEqual(['src/server/auth.ts', 'src/server/sessions.ts'])
    expect(files.get('src/server/sessions.ts')).toEqual({
      statements: 98.4,
      branches: 96.2,
      functions: 100,
      lines: 100,
    })
  })

  it('skips rows that aren’t four numeric percentages, and anything that isn’t a summary', () => {
    expect(parseFileSummary({ '/repo/src/a.ts': { lines: { pct: 'Unknown' } } }, ROOT).size).toBe(0)
    expect(parseFileSummary(null, ROOT).size).toBe(0)
    expect(parseFileSummary([1, 2], ROOT).size).toBe(0)
  })
})

describe('ratchetFiles', () => {
  const at = (statements: number, branches: number, functions: number, lines: number) => ({
    statements,
    branches,
    functions,
    lines,
  })

  it('raises an inline per-file floor below the coverage to the coverage, rounded down, metric by metric', () => {
    const files = new Map([['src/server/sessions.ts', at(98.4, 96.2, 100, 100)]])
    const { config, raised, missing } = ratchetFiles(PER_FILE, files)
    expect(raised).toEqual([
      { file: 'src/server/sessions.ts', metric: 'statements', from: 95, to: 98 },
      { file: 'src/server/sessions.ts', metric: 'branches', from: 90, to: 96 },
    ])
    expect(config).toContain("'src/server/sessions.ts': { statements: 98, branches: 96, functions: 100, lines: 100 },")
    expect(missing).toEqual(['src/server/auth.ts'])
  })

  it('never lowers a per-file floor above the coverage', () => {
    const files = new Map([['src/server/sessions.ts', at(90.2, 89.9, 80, 99.99)]])
    const { config, raised } = ratchetFiles(PER_FILE, files)
    expect(raised).toEqual([])
    expect(config).toBe(PER_FILE)
  })

  it('leaves a FULL entry as it is', () => {
    const files = new Map([
      ['src/server/auth.ts', at(100, 100, 100, 100)],
      ['src/server/sessions.ts', at(95, 90, 100, 100)],
    ])
    const { config, raised, missing } = ratchetFiles(PER_FILE, files)
    expect(raised).toEqual([])
    expect(missing).toEqual([])
    expect(config).toContain("'src/server/auth.ts': FULL,")
  })

  it('writes FULL for an inline floor whose four metrics all reach 100, when the config defines FULL', () => {
    const files = new Map([['src/server/sessions.ts', at(100, 100, 100, 100)]])
    const { config, raised } = ratchetFiles(PER_FILE, files)
    expect(config).toContain("'src/server/sessions.ts': FULL,")
    expect(raised).toEqual([
      { file: 'src/server/sessions.ts', metric: 'statements', from: 95, to: 100 },
      { file: 'src/server/sessions.ts', metric: 'branches', from: 90, to: 100 },
    ])
    const withoutFull = PER_FILE.replace(/^const FULL.*\n/, '').replace("'src/server/auth.ts': FULL,\n", '')
    expect(ratchetFiles(withoutFull, files).config).toContain(
      "'src/server/sessions.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },",
    )
  })

  it('leaves alone, and reports, a threshold entry with no row in the summary', () => {
    const { config, raised, missing } = ratchetFiles(PER_FILE, new Map())
    expect(config).toBe(PER_FILE)
    expect(raised).toEqual([])
    expect(missing).toEqual(['src/server/auth.ts', 'src/server/sessions.ts'])
  })

  it('changes nothing in a config without per-file floors', () => {
    const files = new Map([['src/server/sessions.ts', at(100, 100, 100, 100)]])
    expect(ratchetFiles(INLINE, files)).toEqual({ config: INLINE, raised: [], missing: [] })
  })

  it('leaves the overall thresholds to ratchet()', () => {
    const files = new Map([['src/server/sessions.ts', at(98.4, 96.2, 100, 100)]])
    const { config } = ratchetFiles(PER_FILE, files)
    expect(config).toContain('        statements: 93,\n        branches: 91,')
  })
})
