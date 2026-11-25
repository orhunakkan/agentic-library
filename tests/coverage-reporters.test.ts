import { describe, expect, it } from 'vitest'
import unitConfig from '../vitest.config.ts'
import dbConfig from '../vitest.db.config.ts'

type Reporter = string | [string, Record<string, unknown>?]

/** The text coverage reporters that print to the terminal, which is every one not given a `file`. */
function terminalReporters(reporters: Reporter[]): string[] {
  return reporters
    .map((reporter): [string, Record<string, unknown> | undefined] =>
      typeof reporter === 'string' ? [reporter, undefined] : [reporter[0], reporter[1]],
    )
    .filter(([name, options]) => name.startsWith('text') && !options?.file)
    .map(([name]) => name)
}

describe('terminalReporters', () => {
  it('lists text reporters without a file, and leaves out file and non-text reporters', () => {
    expect(
      terminalReporters(['text-summary', ['text', {}], ['text-summary', { file: 'summary.txt' }], 'html', 'lcovonly']),
    ).toEqual(['text-summary', 'text'])
  })
})

describe.each([
  ['vitest.config.ts', unitConfig],
  ['vitest.db.config.ts', dbConfig],
])('%s', (_path, config) => {
  const reporters = config.test?.coverage?.reporter as Reporter[]

  it('prints no coverage to the terminal, so the run ends on its Test Files / Tests lines', () => {
    expect(terminalReporters(reporters)).toEqual([])
  })

  it('still writes the coverage summary to summary.txt for the ratchet and CI', () => {
    expect(reporters).toContainEqual(['text-summary', { file: 'summary.txt' }])
  })

  it('writes each file’s coverage to coverage-summary.json, which the ratchet raises the per-file floors from', () => {
    expect(reporters).toContainEqual(['json-summary', { file: 'coverage-summary.json' }])
  })
})
