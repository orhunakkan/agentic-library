import { describe, expect, it } from 'vitest'
import { parseSummary, ratchet, type Totals } from './ratchet'

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

  it('raises the overall thresholds to the coverage, rounded down, and leaves the per-file floors alone', () => {
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
