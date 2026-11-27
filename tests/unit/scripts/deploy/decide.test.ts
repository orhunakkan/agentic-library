import { describe, expect, it } from 'vitest'
import {
  ciStateOf,
  decide,
  REFUSALS,
  readDeployRecord,
  recordFacts,
  type ShaFacts,
  type WaitingRequest,
} from '../../../../scripts/deploy/decide.ts'

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)

const request = (id: number, sha: string): WaitingRequest => ({ id, sha })

/** Facts for a commit that passes every check, and isn't live yet. */
const good = (sha: string): ShaFacts => ({
  sha,
  relationToMain: 'behind',
  ci: 'passed',
  devSucceeded: true,
  liveSha: null,
})

describe('decide', () => {
  it('deploys a valid request', () => {
    expect(decide('dev', [request(7, SHA_A)], good(SHA_A))).toEqual([{ kind: 'deploy', id: 7, sha: SHA_A }])
    expect(decide('dev', [request(7, SHA_A)], { ...good(SHA_A), relationToMain: 'identical' })).toEqual([
      { kind: 'deploy', id: 7, sha: SHA_A },
    ])
    expect(decide('production', [request(8, SHA_A)], good(SHA_A))).toEqual([{ kind: 'deploy', id: 8, sha: SHA_A }])
  })

  it('does nothing when nothing is waiting', () => {
    expect(decide('dev', [], null)).toEqual([])
  })

  it('refuses a SHA that isn’t 40 lowercase hex characters, without needing any facts', () => {
    for (const sha of ['abc', SHA_A.toUpperCase(), `${SHA_A}0`, `${'a'.repeat(39)}g`, 'main'])
      expect(decide('dev', [request(1, sha)], null), sha).toEqual([{ kind: 'refuse', id: 1, reason: 'bad_sha' }])
  })

  it('refuses a commit that isn’t main or an ancestor of main', () => {
    for (const relationToMain of ['ahead', 'diverged', null] as const)
      expect(decide('dev', [request(1, SHA_A)], { ...good(SHA_A), relationToMain })).toEqual([
        { kind: 'refuse', id: 1, reason: 'not_on_main' },
      ])
  })

  it('refuses a commit whose CI push run on main hasn’t succeeded', () => {
    expect(decide('dev', [request(1, SHA_A)], { ...good(SHA_A), ci: 'failed' })).toEqual([
      { kind: 'refuse', id: 1, reason: 'ci_not_green' },
    ])
  })

  it('waits, setting no status, while CI is still running for the commit', () => {
    expect(decide('dev', [request(1, SHA_A)], { ...good(SHA_A), ci: 'pending' })).toEqual([{ kind: 'wait', id: 1 }])
    expect(decide('dev', [request(1, SHA_A), request(2, SHA_A)], { ...good(SHA_A), ci: 'pending' })).toEqual([
      { kind: 'supersede', id: 1 },
      { kind: 'wait', id: 2 },
    ])
  })

  it('refuses production for a commit dev hasn’t deployed successfully, and doesn’t ask that of dev', () => {
    const untested = { ...good(SHA_A), devSucceeded: false }
    expect(decide('production', [request(1, SHA_A)], untested)).toEqual([
      { kind: 'refuse', id: 1, reason: 'not_tested_on_dev' },
    ])
    expect(decide('dev', [request(1, SHA_A)], untested)).toEqual([{ kind: 'deploy', id: 1, sha: SHA_A }])
  })

  it('marks a request for the commit already live as done, without deploying it', () => {
    expect(decide('dev', [request(1, SHA_A)], { ...good(SHA_A), liveSha: SHA_A })).toEqual([
      { kind: 'already_deployed', id: 1 },
    ])
  })

  it('still refuses an invalid commit that happens to be live', () => {
    expect(decide('dev', [request(1, SHA_A)], { ...good(SHA_A), liveSha: SHA_A, ci: 'failed' })).toEqual([
      { kind: 'refuse', id: 1, reason: 'ci_not_green' },
    ])
  })

  it('supersedes older dev requests, deploying only the newest', () => {
    const waiting = [request(3, SHA_A), request(9, SHA_B), request(5, SHA_A)]
    expect(decide('dev', waiting, good(SHA_B))).toEqual([
      { kind: 'supersede', id: 3 },
      { kind: 'supersede', id: 5 },
      { kind: 'deploy', id: 9, sha: SHA_B },
    ])
  })

  it('supersedes older production requests too, by request and not by commit, so a rollback works', () => {
    const waiting = [request(4, SHA_B), request(6, SHA_A)]
    expect(decide('production', waiting, { ...good(SHA_A), liveSha: SHA_B })).toEqual([
      { kind: 'supersede', id: 4 },
      { kind: 'deploy', id: 6, sha: SHA_A },
    ])
  })

  it('still supersedes the older requests when the newest is refused', () => {
    expect(decide('dev', [request(1, SHA_A), request(2, 'bad')], null)).toEqual([
      { kind: 'supersede', id: 1 },
      { kind: 'refuse', id: 2, reason: 'bad_sha' },
    ])
  })

  it('refuses to judge a valid SHA without facts about it, or with facts about another', () => {
    expect(() => decide('dev', [request(1, SHA_A)], null)).toThrow(/facts/)
    expect(() => decide('dev', [request(1, SHA_A)], good(SHA_B))).toThrow(/facts/)
  })

  it('gives every refusal a short fixed reason, with no room for a value', () => {
    for (const text of Object.values(REFUSALS)) {
      expect(text.length).toBeLessThanOrEqual(140)
      expect(text).not.toMatch(/[/$]/)
    }
  })
})

describe('ciStateOf', () => {
  it('passes when a run succeeded, waits while one is still running, and fails otherwise', () => {
    expect(
      ciStateOf([
        { status: 'completed', conclusion: 'failure' },
        { status: 'completed', conclusion: 'success' },
      ]),
    ).toBe('passed')
    expect(ciStateOf([{ status: 'in_progress', conclusion: null }])).toBe('pending')
    expect(
      ciStateOf([
        { status: 'queued', conclusion: null },
        { status: 'completed', conclusion: 'failure' },
      ]),
    ).toBe('pending')
    expect(ciStateOf([{ status: 'completed', conclusion: 'cancelled' }])).toBe('failed')
    expect(ciStateOf([])).toBe('failed')
  })
})

describe('the server’s deploy record', () => {
  const line = (environment: string, sha: string) => JSON.stringify({ environment, sha, deployment: 1 })

  it('says whether dev ran a commit, and what each environment runs now', () => {
    const record = readDeployRecord([line('dev', SHA_A), line('production', SHA_A), line('dev', SHA_B), ''].join('\n'))
    expect(recordFacts(record, 'production', SHA_B)).toEqual({ devSucceeded: true, liveSha: SHA_A })
    expect(recordFacts(record, 'dev', SHA_A)).toEqual({ devSucceeded: true, liveSha: SHA_B })
    expect(recordFacts([], 'production', SHA_A)).toEqual({ devSucceeded: false, liveSha: null })
  })

  it('skips torn or malformed lines, so they never count as a deploy', () => {
    const text = [line('dev', SHA_A).slice(0, 20), line('staging', SHA_B), line('dev', 'main'), '[]', 'null'].join('\n')
    expect(readDeployRecord(text)).toEqual([])
  })
})
