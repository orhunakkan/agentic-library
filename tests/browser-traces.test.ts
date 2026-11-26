import { describe, expect, it } from 'vitest'
import { finishedRuns, leftovers } from './browser-traces'

describe('leftovers', () => {
  it('keeps only the trace zips, and clears Playwright’s raw files and folders', () => {
    expect(leftovers(['chromium-a-0-0.trace.zip', 'abc.trace', 'abc.network', 'resources'])).toEqual([
      'abc.trace',
      'abc.network',
      'resources',
    ])
  })
})

describe('finishedRuns', () => {
  it('names the folders of runs that have ended, and anything not named for a run', () => {
    const running = new Set([101])
    expect(finishedRuns(['101', '202', 'stray.zip'], (pid) => running.has(pid))).toEqual(['202', 'stray.zip'])
  })
})
