import { describe, expect, it, vi } from 'vitest'
import type { RepoResult } from '~/client/features/github-repos/repos-client'
import { useRepos } from '~/client/features/github-repos/use-repos'
import type { RepoView } from '~/shared/github-repos/contract'
import { mountHook } from '../../../../support/client/mount'

/** The requests the hook sends, answered by each test. Their own reading of the server's answer is unit-tested. */
const requests = vi.hoisted(() => ({ addRepo: vi.fn(), refreshRepo: vi.fn(), removeRepo: vi.fn() }))
vi.mock('~/client/features/github-repos/repos-client', () => requests)

const repo = (id: string, commit = 'aaaaaaa'): RepoView => ({
  id,
  owner: 'example',
  name: `repo-${id}`,
  description: null,
  ref: null,
  refKind: 'default',
  defaultBranch: 'main',
  commit,
  addedAt: '2026-11-01T00:00:00.000Z',
  checkedAt: '2026-11-01T00:00:00.000Z',
  goneAt: null,
})

const refused: RepoResult<never> = { ok: false, problem: 'busy', failure: { problem: 'busy', retryAt: null } }

const ids = (repos: readonly RepoView[]) => repos.map((r) => r.id)

describe('useRepos', () => {
  it('starts with the repos it is given and no opening paths', () => {
    const hook = mountHook(useRepos, [repo('one'), repo('two')])
    expect(ids(hook.current.repos)).toEqual(['one', 'two'])
    expect(hook.current.paths).toEqual({})
  })

  it('puts an added repo first, once, and remembers the path it opens at', async () => {
    const readded = repo('two', 'bbbbbbb')
    requests.addRepo.mockResolvedValue({ ok: true, value: { repo: readded, path: 'docs/README.md' } })
    const hook = mountHook(useRepos, [repo('one'), repo('two')])

    const result = await hook.current.add('https://github.com/example/repo-two')

    expect(result.ok).toBe(true)
    expect(requests.addRepo).toHaveBeenCalledWith('https://github.com/example/repo-two')
    await vi.waitFor(() => expect(ids(hook.current.repos)).toEqual(['two', 'one']))
    expect(hook.current.repos[0]?.commit).toBe('bbbbbbb')
    expect(hook.current.paths).toEqual({ two: 'docs/README.md' })
  })

  it('records no path for a repo added at its root', async () => {
    requests.addRepo.mockResolvedValue({ ok: true, value: { repo: repo('new'), path: '' } })
    const hook = mountHook(useRepos, [])
    await hook.current.add('https://github.com/example/repo-new')
    await vi.waitFor(() => expect(ids(hook.current.repos)).toEqual(['new']))
    expect(hook.current.paths).toEqual({})
  })

  it('keeps both of two adds that finish out of order', async () => {
    const first = Promise.withResolvers<RepoResult<{ repo: RepoView; path: string }>>()
    const second = Promise.withResolvers<RepoResult<{ repo: RepoView; path: string }>>()
    requests.addRepo.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const hook = mountHook(useRepos, [repo('old')])

    const adding = [hook.current.add('first'), hook.current.add('second')]
    second.resolve({ ok: true, value: { repo: repo('second'), path: 'b' } })
    first.resolve({ ok: true, value: { repo: repo('first'), path: 'a' } })
    await Promise.all(adding)

    await vi.waitFor(() => expect(ids(hook.current.repos)).toEqual(['first', 'second', 'old']))
    expect(hook.current.paths).toEqual({ first: 'a', second: 'b' })
  })

  it('replaces a refreshed repo where it is', async () => {
    requests.refreshRepo.mockResolvedValue({ ok: true, value: { repo: repo('two', 'ccccccc'), changed: true } })
    const hook = mountHook(useRepos, [repo('one'), repo('two'), repo('three')])

    await hook.current.refresh('two')

    expect(requests.refreshRepo).toHaveBeenCalledWith('two')
    await vi.waitFor(() => expect(hook.current.repos[1]?.commit).toBe('ccccccc'))
    expect(ids(hook.current.repos)).toEqual(['one', 'two', 'three'])
  })

  it('drops a removed repo', async () => {
    requests.removeRepo.mockResolvedValue({ ok: true, value: true })
    const hook = mountHook(useRepos, [repo('one'), repo('two')])

    await hook.current.remove('one')

    expect(requests.removeRepo).toHaveBeenCalledWith('one')
    await vi.waitFor(() => expect(ids(hook.current.repos)).toEqual(['two']))
  })

  it('changes nothing when the server refuses, and hands back why', async () => {
    requests.addRepo.mockResolvedValue(refused)
    requests.refreshRepo.mockResolvedValue(refused)
    requests.removeRepo.mockResolvedValue(refused)
    const start = [repo('one'), repo('two')]
    const hook = mountHook(useRepos, start)

    expect(await hook.current.add('https://github.com/example/repo-three')).toEqual(refused)
    expect(await hook.current.refresh('one')).toEqual(refused)
    expect(await hook.current.remove('two')).toEqual(refused)

    expect(hook.current.repos).toBe(start)
    expect(hook.current.paths).toEqual({})
  })

  it('keeps its own list when it is rendered again with another one', () => {
    const hook = mountHook(useRepos, [repo('one')])
    hook.rerender([repo('other')])
    expect(ids(hook.current.repos)).toEqual(['one'])
  })
})
