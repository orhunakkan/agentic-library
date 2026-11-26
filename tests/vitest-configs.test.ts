import { describe, expect, it } from 'vitest'
import browserConfig from '../vitest.browser.config.ts'
import unitConfig from '../vitest.config.ts'
import dbConfig from '../vitest.db.config.ts'

/** Settings every Vitest config must keep, since there's no CI to catch a run that quietly does less than it should. */
describe.each([
  ['vitest.config.ts', unitConfig],
  ['vitest.db.config.ts', dbConfig],
  ['vitest.browser.config.ts', browserConfig],
])('%s', (_path, config) => {
  it('fails the run on a stray .only, which would otherwise skip every other test and still pass', () => {
    expect(config.test?.allowOnly).toBe(false)
  })

  it('undoes every spy, stubbed global and stubbed env var before each test, so none leaks into the next', () => {
    expect(config.test).toMatchObject({ restoreMocks: true, unstubGlobals: true, unstubEnvs: true })
  })
})

describe.each([
  ['vitest.config.ts', unitConfig],
  ['vitest.db.config.ts', dbConfig],
])('%s', (_path, config) => {
  it('runs files and tests in a shuffled order, so a test that leans on an earlier one fails', () => {
    expect(config.test?.sequence?.shuffle).toBe(true)
  })
})
