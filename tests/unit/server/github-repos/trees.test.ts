import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/server/config.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/server/config.ts')>()
  return {
    ...actual,
    getConfig: () => ({
      ...actual.parseConfig({}),
      githubApiBase: 'https://api.github.test',
      githubRawBase: 'https://raw.github.test',
    }),
  }
})

import { childrenOf } from '~/server/github-repos/files.ts'
import { resetGitHub } from '~/server/github-repos/github.ts'
import { loadFolder, loadTree, resetTrees } from '~/server/github-repos/trees.ts'

const COMMIT = 'a'.repeat(40)
const DOCS = 'b'.repeat(40)
const README = 'c'.repeat(40)
const KEY = { githubId: 1, owner: 'o', name: 'r', commit: COMMIT }

const blob = (path: string, sha = README) => ({ path, mode: '100644', type: 'blob', sha, size: 5 })
const folder = (path: string, sha: string) => ({ path, mode: '040000', type: 'tree', sha })

/** GitHub as it answers a repository whose whole tree is more than Folio reads: 9 MB for the recursive listing. */
function hugeRepository() {
  const asked: string[] = []
  const fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    asked.push(`${url.pathname}${url.search}`)
    if (url.search === '?recursive=1') return new Response('x'.repeat(9 * 1024 * 1024))
    if (url.pathname.endsWith(`/git/trees/${COMMIT}`))
      return Response.json({ sha: COMMIT, truncated: false, tree: [blob('README.md'), folder('docs', DOCS)] })
    return Response.json({ sha: DOCS, truncated: false, tree: [blob('guide.md')] })
  }) as typeof globalThis.fetch
  return { fetch, asked }
}

beforeEach(() => {
  resetGitHub()
  resetTrees()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('loadTree', () => {
  it('loads a tree too large to read whole one folder at a time, as it does a truncated one', async () => {
    const github = hugeRepository()
    const loaded = await loadTree(KEY, github)
    if (!loaded.ok) throw new Error(`loadTree failed: ${loaded.problem}`)
    const tree = loaded.value
    expect(tree.complete).toBe(false)
    expect(childrenOf(tree, '')?.map((e) => e.name)).toEqual(['docs', 'README.md'])
    expect(await loadFolder(KEY, tree, 'docs', github)).toEqual({ ok: true, value: true })
    expect(childrenOf(tree, 'docs')?.map((e) => e.path)).toEqual(['docs/guide.md'])
    expect(github.asked).toEqual([
      `/repos/o/r/git/trees/${COMMIT}?recursive=1`,
      `/repos/o/r/git/trees/${COMMIT}`,
      `/repos/o/r/git/trees/${DOCS}`,
    ])
  })
})
