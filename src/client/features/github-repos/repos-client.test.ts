import { afterEach, describe, expect, it, vi } from 'vitest'
import { addRepo, readRepoAnswer, refreshRepo, removeRepo, repoHref, repoRawHref } from './repos-client'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
const REPO = { id: 'r1', owner: 'o', name: 'n' }

function answering(response: Response | Error) {
  const fetchMock = vi.fn(async () => {
    if (response instanceof Error) throw response
    return response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('the requests', () => {
  it('adds a repository by its address', async () => {
    const fetchMock = answering(json(201, { repo: REPO, path: 'docs' }))
    expect(await addRepo('https://github.com/o/n')).toEqual({ ok: true, value: { repo: REPO, path: 'docs' } })
    expect(fetchMock).toHaveBeenCalledWith('/account/repos/new', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://github.com/o/n' }),
    })
  })

  it('refreshes and removes one', async () => {
    answering(json(200, { repo: REPO, changed: true }))
    expect(await refreshRepo('r1')).toEqual({ ok: true, value: { repo: REPO, changed: true } })
    answering(json(200, { removed: true }))
    expect(await removeRepo('r1')).toEqual({ ok: true, value: true })
  })

  it('a network failure is unavailable', async () => {
    answering(new TypeError('offline'))
    expect(await removeRepo('r1')).toMatchObject({ ok: false, problem: 'unavailable' })
  })
})

describe('readRepoAnswer', () => {
  const pick = (b: Record<string, unknown>) => (b.repo ? b.repo : undefined)

  it('maps the address’s reason and each code', async () => {
    expect(await readRepoAnswer(json(400, { error: 'invalid', reason: 'not_github' }), pick)).toMatchObject({
      problem: 'not_github',
    })
    expect(await readRepoAnswer(json(400, { error: 'invalid' }), pick)).toMatchObject({ problem: 'failed' })
    for (const code of ['signed_out', 'not_found', 'ref_not_found', 'quota', 'limited', 'unavailable', 'failed'])
      expect(await readRepoAnswer(json(400, { error: code }), pick)).toMatchObject({ problem: code })
    expect(await readRepoAnswer(json(500, { error: 'nonsense' }), pick)).toMatchObject({ problem: 'failed' })
    expect(await readRepoAnswer(new Response('not json', { status: 502 }), pick)).toMatchObject({ problem: 'failed' })
  })

  it('carries the existing id and busy’s time', async () => {
    expect(await readRepoAnswer(json(409, { error: 'exists', id: 'r9' }), pick)).toEqual({
      ok: false,
      problem: 'exists',
      failure: { problem: 'exists', existingId: 'r9' },
    })
    expect(await readRepoAnswer(json(503, { error: 'busy', retryAt: '2026-11-21T14:05:00Z' }), pick)).toMatchObject({
      failure: { problem: 'busy', retryAt: '2026-11-21T14:05:00Z' },
    })
    expect(await readRepoAnswer(json(503, { error: 'busy' }), pick)).toMatchObject({ failure: { retryAt: null } })
  })

  it('an answer without its value is failed', async () => {
    expect(await readRepoAnswer(json(200, {}), pick)).toMatchObject({ ok: false, problem: 'failed' })
  })
})

describe('the addresses', () => {
  it('builds the viewer’s and the raw endpoint’s', () => {
    expect(repoHref('r1')).toBe('/account/repos/r1')
    expect(repoHref('r1', 'docs/My Notes.md')).toBe('/account/repos/r1?path=docs%2FMy+Notes.md')
    expect(repoHref('r1', 'README.md', 'code')).toBe('/account/repos/r1?path=README.md&view=code')
    expect(repoHref('r1', 'a.md', 'preview', 'user-content-x y')).toBe('/account/repos/r1?path=a.md#user-content-x%20y')
    expect(repoRawHref('r1', 'img/a b.png')).toBe('/account/repos/r1/raw?path=img%2Fa+b.png')
  })
})
