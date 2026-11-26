import { beforeEach, describe, expect, it, vi } from 'vitest'

const TOKEN = `github_pat_${'A1_'.repeat(10)}`
vi.mock('../config.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config.ts')>()
  return {
    ...actual,
    getConfig: () => ({
      ...actual.parseConfig({}),
      githubToken: TOKEN,
      githubApiBase: 'https://api.github.test',
      githubRawBase: 'https://raw.github.test',
    }),
  }
})

import {
  getRaw,
  getRepo,
  getRepoById,
  getTree,
  limitedUntil,
  MAX_IN_FLIGHT,
  requestsInFlight,
  resetGitHub,
  resolveRef,
} from './github.ts'

const SHA = 'a'.repeat(40)

function answering(make: () => Response) {
  const asked: { url: string; headers: Headers }[] = []
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    asked.push({ url: String(input), headers: new Headers(init?.headers) })
    return make()
  }) as typeof globalThis.fetch
  return { fetch, asked }
}

const json =
  (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  () =>
    Response.json(body, { status, headers })

beforeEach(resetGitHub)

describe('requests', () => {
  it('send the token, the API version and Folio’s User-Agent', async () => {
    const { fetch, asked } = answering(json({ id: 1, full_name: 'o/r', private: false, default_branch: 'main' }))
    expect(await getRepo('o', 'r', { fetch })).toMatchObject({ ok: true, value: { owner: 'o', name: 'r' } })
    expect(asked[0]?.url).toBe('https://api.github.test/repos/o/r')
    expect(asked[0]?.headers.get('authorization')).toBe(`Bearer ${TOKEN}`)
    expect(asked[0]?.headers.get('x-github-api-version')).toBe('2022-11-28')
    expect(asked[0]?.headers.get('user-agent')).toMatch(/^Folio \(\+/)
  })

  it('answer a repository GitHub doesn’t answer with 200 or with its shape as unavailable', async () => {
    expect(
      await getRepoById(
        1,
        answering(() => new Response(null, { status: 304 })),
      ),
    ).toEqual({
      ok: false,
      problem: 'unavailable',
    })
    expect(await getRepoById(1, answering(json({ id: 'x', private: false })))).toEqual({
      ok: false,
      problem: 'unavailable',
    })
    expect(await getRepoById(1, answering(json({ id: 1 })))).toEqual({ ok: false, problem: 'not-found' })
    expect(
      await getRepoById(
        1,
        answering(() => new Response('not json')),
      ),
    ).toEqual({
      ok: false,
      problem: 'unavailable',
    })
  })

  it('a 403 that isn’t the limit is unavailable, and doesn’t stop the client', async () => {
    expect(await getRepo('o', 'r', answering(json({ message: 'Forbidden' }, 403)))).toEqual({
      ok: false,
      problem: 'unavailable',
    })
    expect(limitedUntil()).toBeNull()
  })

  it('a 429 without a time stops the client for a minute; retry-after for its own time', async () => {
    const before = Date.now()
    const busy = await getRepo('o', 'r', answering(json({}, 429)))
    expect(busy).toMatchObject({ ok: false, problem: 'busy' })
    expect(limitedUntil()?.getTime()).toBeGreaterThanOrEqual(before + 59_000)
    resetGitHub()
    const after = await getRepo('o', 'r', answering(json({}, 403, { 'retry-after': '120' })))
    expect(after.ok === false && after.retryAt?.getTime()).toBeGreaterThanOrEqual(before + 119_000)
  })
})

describe('resolveRef', () => {
  it('reads the SHA, keeps the ETag, and answers a 304 from it', async () => {
    const first = answering(() => new Response(SHA, { headers: { etag: `"${SHA}"` } }))
    expect(await resolveRef('o', 'r', 'feature/x', { fetch: first.fetch })).toEqual({ ok: true, value: SHA })
    expect(first.asked[0]?.url).toBe('https://api.github.test/repos/o/r/commits/feature/x')
    const second = answering(() => new Response(null, { status: 304 }))
    expect(await resolveRef('o', 'r', 'feature/x', { fetch: second.fetch })).toEqual({ ok: true, value: SHA })
    expect(second.asked[0]?.headers.get('if-none-match')).toBe(`"${SHA}"`)
  })

  it('without an ETag asks unconditionally next time', async () => {
    await resolveRef(
      'o',
      'r',
      'main',
      answering(() => new Response(SHA)),
    )
    const next = answering(() => new Response(SHA))
    await resolveRef('o', 'r', 'main', next)
    expect(next.asked[0]?.headers.get('if-none-match')).toBeNull()
  })

  it('answers what isn’t a SHA, or a 304 it has no ETag for, as unavailable', async () => {
    expect(
      await resolveRef(
        'o',
        'r',
        'main',
        answering(() => new Response('{"message":"x"}')),
      ),
    ).toEqual({
      ok: false,
      problem: 'unavailable',
    })
    expect(
      await resolveRef(
        'o',
        'r',
        'dev',
        answering(() => new Response(null, { status: 304 })),
      ),
    ).toEqual({
      ok: false,
      problem: 'unavailable',
    })
  })

  it('passes a failure through', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(
      await resolveRef(
        'o',
        'r',
        'main',
        answering(() => new Response('x', { status: 500 })),
      ),
    ).toEqual({
      ok: false,
      problem: 'unavailable',
    })
  })
})

describe('getTree', () => {
  it('reads a tree, and answers empty, other statuses and other shapes', async () => {
    const tree = { sha: SHA, truncated: false, tree: [] }
    expect(await getTree('o', 'r', SHA, { recursive: false }, answering(json(tree)))).toEqual({
      ok: true,
      value: { sha: SHA, truncated: false, entries: [] },
    })
    expect(await getTree('o', 'r', SHA, { recursive: true }, answering(json({}, 409)))).toEqual({
      ok: false,
      problem: 'empty',
    })
    expect(await getTree('o', 'r', SHA, { recursive: true }, answering(json({}, 422)))).toEqual({
      ok: false,
      problem: 'unavailable',
    })
    expect(await getTree('o', 'r', SHA, { recursive: true }, answering(json({ sha: 'x' })))).toEqual({
      ok: false,
      problem: 'unavailable',
    })
  })
})

describe('getRaw', () => {
  it('reads a file’s bytes with each segment encoded, and passes a failure through', async () => {
    const ok = answering(() => new Response('hello'))
    const read = await getRaw('o', 'r', SHA, 'docs/My Notes#1.md', 100, ok)
    expect(read.ok && Buffer.from(read.value).toString()).toBe('hello')
    expect(ok.asked[0]?.url).toBe(`https://raw.github.test/o/r/${SHA}/docs/My%20Notes%231.md`)
    expect(
      await getRaw(
        'o',
        'r',
        SHA,
        'x',
        100,
        answering(() => new Response('', { status: 404 })),
      ),
    ).toEqual({
      ok: false,
      problem: 'not-found',
    })
  })

  it('answers busy without sending past 6 requests in flight', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const slow = (async () => {
      await gate
      return new Response('x')
    }) as unknown as typeof fetch
    const waiting = Array.from({ length: MAX_IN_FLIGHT }, () => getRaw('o', 'r', SHA, 'a', 10, { fetch: slow }))
    expect(requestsInFlight()).toBe(MAX_IN_FLIGHT)
    expect(
      await getRaw(
        'o',
        'r',
        SHA,
        'a',
        10,
        answering(() => new Response('x')),
      ),
    ).toEqual({
      ok: false,
      problem: 'busy',
    })
    expect(await getRepo('o', 'r', answering(json({})))).toEqual({ ok: false, problem: 'busy' })
    release()
    await Promise.all(waiting)
    expect(requestsInFlight()).toBe(0)
  })
})
