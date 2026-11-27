import { beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import type { RepoResult } from '~/client/features/github-repos/repos-client'
import { useRepos } from '~/client/features/github-repos/use-repos'
import type { RepoErrorCode, RepoView } from '~/shared/github-repos/contract'
import type { ErrorAnswer } from '../../../../support/client/answers'
import { mountHook } from '../../../../support/client/mount'

/**
 * A repo endpoint's answer, as `src/server/github-repos/actions.ts` sends it. The refusal codes are the contract's;
 * the success bodies have no shared type, so they are written to match the handler.
 */
const repoJson = (
  status: number,
  body:
    | { repo: RepoView; path: string }
    | { repo: RepoView; changed: boolean }
    | { removed: true }
    | ErrorAnswer<RepoErrorCode>,
) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** The network: each test says what the repo endpoints answer, and a request it didn't expect gets no answer. */
let fetchSpy: MockInstance<typeof fetch>

/** Each request sent to the network, as its path, method and JSON body. */
const sent = () =>
  fetchSpy.mock.calls.map(([path, init]) => ({
    path: String(path),
    method: init?.method,
    body: JSON.parse(String(init?.body)) as unknown,
  }))

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No answer for this request'))
})

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
    fetchSpy.mockResolvedValue(repoJson(201, { repo: readded, path: 'docs/README.md' }))
    const hook = mountHook(useRepos, [repo('one'), repo('two')])

    const result = await hook.current.add('https://github.com/example/repo-two')

    expect(result.ok).toBe(true)
    expect(sent()).toEqual([
      { path: '/account/repos/new', method: 'POST', body: { url: 'https://github.com/example/repo-two' } },
    ])
    await vi.waitFor(() => expect(ids(hook.current.repos)).toEqual(['two', 'one']))
    expect(hook.current.repos[0]?.commit).toBe('bbbbbbb')
    expect(hook.current.paths).toEqual({ two: 'docs/README.md' })
  })

  it('records no path for a repo added at its root', async () => {
    fetchSpy.mockResolvedValue(repoJson(201, { repo: repo('new'), path: '' }))
    const hook = mountHook(useRepos, [])
    await hook.current.add('https://github.com/example/repo-new')
    await vi.waitFor(() => expect(ids(hook.current.repos)).toEqual(['new']))
    expect(hook.current.paths).toEqual({})
  })

  it('keeps both of two adds that finish out of order', async () => {
    const first = Promise.withResolvers<Response>()
    const second = Promise.withResolvers<Response>()
    fetchSpy.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const hook = mountHook(useRepos, [repo('old')])

    const adding = [hook.current.add('first'), hook.current.add('second')]
    second.resolve(repoJson(201, { repo: repo('second'), path: 'b' }))
    first.resolve(repoJson(201, { repo: repo('first'), path: 'a' }))
    await Promise.all(adding)

    await vi.waitFor(() => expect(ids(hook.current.repos)).toEqual(['first', 'second', 'old']))
    expect(hook.current.paths).toEqual({ first: 'a', second: 'b' })
  })

  it('replaces a refreshed repo where it is', async () => {
    fetchSpy.mockResolvedValue(repoJson(200, { repo: repo('two', 'ccccccc'), changed: true }))
    const hook = mountHook(useRepos, [repo('one'), repo('two'), repo('three')])

    await hook.current.refresh('two')

    expect(sent()).toEqual([{ path: '/account/repos/two', method: 'POST', body: { intent: 'refresh' } }])
    await vi.waitFor(() => expect(hook.current.repos[1]?.commit).toBe('ccccccc'))
    expect(ids(hook.current.repos)).toEqual(['one', 'two', 'three'])
  })

  it('drops a removed repo', async () => {
    fetchSpy.mockResolvedValue(repoJson(200, { removed: true }))
    const hook = mountHook(useRepos, [repo('one'), repo('two')])

    await hook.current.remove('one')

    expect(sent()).toEqual([{ path: '/account/repos/one', method: 'POST', body: { intent: 'remove' } }])
    await vi.waitFor(() => expect(ids(hook.current.repos)).toEqual(['two']))
  })

  it('changes nothing when the server refuses, and hands back why', async () => {
    /** A fresh answer for each request, as a body can be read only once. */
    fetchSpy.mockImplementation(async () => repoJson(503, { error: 'busy', retryAt: null }))
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
