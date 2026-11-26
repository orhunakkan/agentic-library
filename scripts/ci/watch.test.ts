import { describe, expect, it } from 'vitest'
import { type Job, type Tools, verdict, watchCi } from './watch.ts'

const SHA = 'abc1234def5678abc1234def5678abc1234def56'
const URL = 'https://github.com/o/r/actions/runs/77'

function jobs(checks: string, db: string, deploy: string): Job[] {
  return [
    { name: 'Lint, types, unit tests, build, audit', conclusion: checks },
    { name: 'Database tests', conclusion: db },
    { name: 'Deploy to dev', conclusion: deploy },
  ]
}

interface Fake {
  /** `gh run list` answers this many times with no run, then with the run for SHA. */
  listsBeforeRun?: number
  /** The first this many `gh run list` calls fail, as gh does on a network drop. */
  failingLists?: number
  /** `gh run watch` fails with this message. */
  watchError?: string
  status?: string
}

function fakeTools({ listsBeforeRun = 0, failingLists = 0, watchError, status = 'completed' }: Fake) {
  let clock = 0
  let lists = 0
  const ghCalls: string[][] = []
  const said: string[] = []
  const tools: Tools = {
    git: (args) => (args.includes('--short') ? 'abc1234' : SHA),
    gh: async (args) => {
      ghCalls.push(args)
      if (args[1] === 'list') {
        lists++
        if (lists <= failingLists) throw new Error('gh run list exited 1: connection reset')
        return lists > failingLists + listsBeforeRun ? JSON.stringify([{ databaseId: 77, url: URL }]) : '[]'
      }
      if (args[1] === 'watch' && watchError) throw new Error(watchError)
      if (args[1] === 'view') {
        return JSON.stringify({ status, url: URL, jobs: jobs('success', 'success', 'success') })
      }
      return ''
    },
    sleep: async (ms) => {
      clock += ms
    },
    now: () => clock,
    say: (line) => said.push(line),
  }
  return { tools, ghCalls, said }
}

describe('watchCi', () => {
  it('finds the ci.yml run for the full SHA of the ref, watches it, and judges its jobs', async () => {
    const { tools, ghCalls, said } = fakeTools({ listsBeforeRun: 2 })
    const result = await watchCi('HEAD', tools)
    expect(result.ok).toBe(true)
    expect(result.lines.at(-1)).toBe(`CI success for abc1234: ${URL}`)
    expect(ghCalls[0]).toEqual(expect.arrayContaining(['run', 'list', '--workflow', 'ci.yml', '--commit', SHA]))
    expect(ghCalls.map((args) => args[1])).toEqual(['list', 'list', 'list', 'watch', 'view'])
    expect(ghCalls[3]).toEqual(expect.arrayContaining(['77', '--exit-status']))
    expect(said).toEqual(['Waiting for the ci.yml run for abc1234 to appear', `Watching ${URL}`])
  })

  it('keeps looking when gh run list fails for a moment', async () => {
    const { tools } = fakeTools({ failingLists: 2 })
    expect((await watchCi('HEAD', tools)).ok).toBe(true)
  })

  it('fails with a clear message and a verdict line when no run appears before the timeout', async () => {
    const { tools, ghCalls } = fakeTools({ listsBeforeRun: Number.POSITIVE_INFINITY })
    const result = await watchCi('HEAD', tools)
    expect(result).toEqual({
      ok: false,
      lines: ['No ci.yml run appeared for abc1234 within 5 minutes; was it pushed?', 'CI failure for abc1234: no run'],
    })
    expect(ghCalls.every((args) => args[1] === 'list')).toBe(true)
  })

  it('names the last gh error when every lookup failed', async () => {
    const { tools } = fakeTools({ failingLists: Number.POSITIVE_INFINITY })
    const result = await watchCi('HEAD', tools)
    expect(result.ok).toBe(false)
    expect(result.lines).toContain('Last gh error: gh run list exited 1: connection reset')
    expect(result.lines.at(-1)).toBe('CI failure for abc1234: no run')
  })

  it('fails, with the reason gh gave, when the watch stops before the run completes', async () => {
    const { tools } = fakeTools({ watchError: 'gh run watch exited 1: HTTP 401', status: 'in_progress' })
    const result = await watchCi('HEAD', tools)
    expect(result.ok).toBe(false)
    expect(result.lines[0]).toBe('The run is still in_progress: gh run watch exited 1: HTTP 401')
    expect(result.lines.at(-1)).toBe(`CI failure for abc1234: ${URL}`)
  })
})

const RUN = { url: 'https://github.com/o/r/actions/runs/1', shortSha: 'abc1234' }

describe('verdict', () => {
  it('passes when every job succeeded, one line per job and the verdict last', () => {
    expect(verdict(jobs('success', 'success', 'success'), RUN)).toEqual({
      ok: true,
      lines: [
        'Lint, types, unit tests, build, audit: success',
        'Database tests: success',
        'Deploy to dev: success',
        'CI success for abc1234: https://github.com/o/r/actions/runs/1',
      ],
    })
  })

  it('fails when any job did not succeed, and names that job', () => {
    const result = verdict(jobs('success', 'failure', 'skipped'), RUN)
    expect(result.ok).toBe(false)
    expect(result.lines).toContain('Database tests: failure')
    expect(result.lines.at(-1)).toBe('CI failure for abc1234: https://github.com/o/r/actions/runs/1')
  })

  it('lets the deploy job be skipped, since ci.yml deploys only for a push to main', () => {
    expect(verdict(jobs('success', 'success', 'skipped'), RUN).ok).toBe(true)
  })

  it('fails when a test job was skipped', () => {
    expect(verdict(jobs('skipped', 'skipped', 'skipped'), RUN).ok).toBe(false)
  })

  it('fails a run with no jobs', () => {
    expect(verdict([], RUN)).toEqual({
      ok: false,
      lines: ['CI failure for abc1234: https://github.com/o/r/actions/runs/1'],
    })
  })
})
