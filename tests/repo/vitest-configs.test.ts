import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import browserConfig from '../vitest.browser.config.ts'
import unitConfig from '../vitest.config.ts'
import integrationConfig from '../vitest.integration.config.ts'

/** Settings every Vitest config must keep, since there's no CI to catch a run that quietly does less than it should. */
describe.each([
  ['vitest.config.ts', unitConfig],
  ['vitest.integration.config.ts', integrationConfig],
  ['vitest.browser.config.ts', browserConfig],
])('%s', (_path, config) => {
  it('fails the run on a stray .only, which would otherwise skip every other test and still pass', () => {
    expect(config.test?.allowOnly).toBe(false)
  })

  it('undoes every spy, stubbed global and stubbed env var before each test, so none leaks into the next', () => {
    expect(config.test).toMatchObject({ restoreMocks: true, unstubGlobals: true, unstubEnvs: true })
  })

  it('pins its root to the repo folder, so its paths mean the same wherever Vitest is started from', () => {
    expect(config.root).toBe(fileURLToPath(new URL('../..', import.meta.url)))
  })
})

describe.each([
  ['vitest.config.ts', unitConfig],
  ['vitest.integration.config.ts', integrationConfig],
])('%s', (_path, config) => {
  it('runs files and tests in a shuffled order, so a test that leans on an earlier one fails', () => {
    expect(config.test?.sequence?.shuffle).toBe(true)
  })
})

describe('package.json and the pre-commit hook', () => {
  it('name a config in tests/ in every Vitest command, since without one Vitest quietly loads vite.config.ts', () => {
    const commands = ['package.json', '.githooks/pre-commit']
      .flatMap((file) => readFileSync(file, 'utf8').split('\n'))
      .filter((line) => !line.trimStart().startsWith('#'))
      .flatMap((line) => line.split(/&&|\|\||[;|]/))
      .filter((command) => /(^|[\s"])vitest\s/.test(command))
    expect(commands.length).toBeGreaterThanOrEqual(5)
    expect(commands.filter((command) => !/\s--config tests\/vitest(\.\w+)?\.config\.ts\b/.test(command))).toEqual([])
  })
})
