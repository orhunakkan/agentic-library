import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isSha, parseCommitSha, parseRateLimit, parseRepo, parseTree } from './github-parse.ts'

const answers = JSON.parse(
  readFileSync(new URL('../../../tests/stubs/github/answers.json', import.meta.url), 'utf8'),
) as Record<string, { body: unknown }>
const body = (name: string) => answers[name]?.body

describe('the saved answers', () => {
  it('a repository', () => {
    expect(parseRepo(body('repo'))).toEqual({
      githubId: 1158722119,
      owner: 'addyosmani',
      name: 'agent-skills',
      defaultBranch: 'main',
      description: 'Production-grade engineering skills for AI coding agents.',
    })
  })

  it('a commit’s SHA', () => {
    expect(parseCommitSha(`${body('commitSha')}`)).toBe('8c99fa36d90068c82d547f7c12a9d67a3e95f4ee')
  })

  it('a recursive tree, with a symbolic link', () => {
    const tree = parseTree(body('tree'))
    expect(tree?.truncated).toBe(false)
    expect(tree?.entries.find((e) => e.path === '.opencode/skills')).toMatchObject({ mode: '120000', type: 'blob' })
    expect(tree?.entries.find((e) => e.path === 'skills')).toMatchObject({ type: 'tree', size: null })
  })

  it('the refusals aren’t repositories or trees', () => {
    expect(parseRepo(body('repoMissing'))).toBe('private')
    expect(parseTree(body('commitUnknownRef'))).toBeNull()
  })
})

describe('parseRepo', () => {
  const good = { id: 1, full_name: 'o/r', private: false, visibility: 'public', default_branch: 'main' }

  it('treats anything not public as private', () => {
    expect(parseRepo({ ...good, private: true })).toBe('private')
    expect(parseRepo({ ...good, visibility: 'internal' })).toBe('private')
  })

  it('refuses a malformed answer', () => {
    expect(parseRepo('x')).toBeNull()
    expect(parseRepo({ ...good, id: '1' })).toBeNull()
    expect(parseRepo({ ...good, id: 0 })).toBeNull()
    expect(parseRepo({ ...good, full_name: 'o' })).toBeNull()
    expect(parseRepo({ ...good, full_name: 'o/r/x' })).toBeNull()
    expect(parseRepo({ ...good, full_name: 3 })).toBeNull()
    expect(parseRepo({ ...good, default_branch: '' })).toBeNull()
  })

  it('cuts the description at 350 characters, and an empty one is null', () => {
    expect(parseRepo({ ...good, description: 'x'.repeat(400) })).toMatchObject({ description: 'x'.repeat(350) })
    expect(parseRepo({ ...good, description: '  ' })).toMatchObject({ description: null })
    expect(parseRepo({ ...good, description: null, visibility: undefined })).toMatchObject({ description: null })
  })
})

describe('parseCommitSha and isSha', () => {
  it('takes 40 hex characters only', () => {
    expect(parseCommitSha(`${'a'.repeat(40)}\n`)).toBe('a'.repeat(40))
    expect(parseCommitSha('A'.repeat(40))).toBeNull()
    expect(parseCommitSha('{"message":"x"}')).toBeNull()
    expect(isSha(3)).toBe(false)
  })
})

describe('parseTree', () => {
  const sha = 'b'.repeat(40)
  const entry = { path: 'a.md', mode: '100644', type: 'blob', sha, size: 3 }
  const tree = (entries: unknown[]) => ({ sha, truncated: false, tree: entries })

  it('reads entries', () => {
    expect(parseTree(tree([entry, { path: 'lib', mode: '160000', type: 'commit', sha }]))?.entries).toEqual([
      { path: 'a.md', mode: '100644', type: 'blob', sha, size: 3 },
      { path: 'lib', mode: '160000', type: 'commit', sha, size: null },
    ])
  })

  it('refuses the whole answer for one bad entry', () => {
    for (const bad of [
      'x',
      { ...entry, path: '' },
      { ...entry, path: '/etc' },
      { ...entry, path: 'a/../b' },
      { ...entry, path: 'a\0b' },
      { ...entry, mode: 'x' },
      { ...entry, type: 'tag' },
      { ...entry, sha: 'x' },
      { ...entry, size: -1 },
      { ...entry, size: undefined },
    ])
      expect(parseTree(tree([entry, bad]))).toBeNull()
    expect(parseTree({ sha, tree: [] })).toBeNull()
    expect(parseTree(null)).toBeNull()
  })
})

describe('parseRateLimit', () => {
  it('reads the remaining calls, the reset and retry-after', () => {
    const headers = new Headers({
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': '1795246953',
      'retry-after': '60',
    })
    expect(parseRateLimit(headers, 1000)).toEqual({
      remaining: 0,
      resetAt: new Date(1795246953 * 1000),
      retryAt: new Date(61_000),
    })
    expect(parseRateLimit(new Headers({ 'x-ratelimit-remaining': 'lots' }))).toEqual({
      remaining: null,
      resetAt: null,
      retryAt: null,
    })
  })
})
