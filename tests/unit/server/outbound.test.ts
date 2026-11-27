import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchCapped, type OutboundOptions } from '~/server/outbound'

const HOST = 'https://service.example'

function options(fetchFn: typeof fetch, extra: Partial<OutboundOptions> = {}): OutboundOptions {
  return {
    accept: 'application/json',
    maxBytes: 16,
    timeoutMs: 1000,
    redirects: 2,
    allowRedirect: (target) => target.origin === HOST,
    userAgent: 'Folio (+http://localhost:3000)',
    log: { label: 'service', path: (url) => url.pathname.split('/').slice(0, 2).join('/') },
    fetch: fetchFn,
    ...extra,
  }
}

function table(answers: Record<string, () => Response>) {
  const asked: { url: string; init: RequestInit | undefined }[] = []
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    asked.push({ url: url.href, init })
    const answer = answers[url.pathname]
    return answer ? answer() : new Response('missing', { status: 404 })
  }) as typeof fetch
  return { fn, asked }
}

const redirect = (location: string) => () => new Response(null, { status: 302, headers: { location } })

afterEach(() => {
  vi.useRealTimers()
})

describe('fetchCapped', () => {
  it('answers the body and status, sending the User-Agent and Accept, without following anything itself', async () => {
    const { fn, asked } = table({ '/a/b': () => new Response('{"ok":true}', { status: 200 }) })
    const answer = await fetchCapped(`${HOST}/a/b`, options(fn))
    expect(answer).toMatchObject({ ok: true, status: 200 })
    if (answer.ok) expect(Buffer.from(answer.body).toString()).toBe('{"ok":true}')
    const headers = new Headers(asked[0]?.init?.headers)
    expect(headers.get('user-agent')).toBe('Folio (+http://localhost:3000)')
    expect(headers.get('accept')).toBe('application/json')
    expect(asked[0]?.init?.redirect).toBe('manual')
  })

  it('sends the caller’s headers, and answers the statuses it handles itself with their headers', async () => {
    const { fn, asked } = table({
      '/sha': () => new Response(null, { status: 304, headers: { etag: '"x"' } }),
      '/limit': () => new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }),
    })
    const extra = { headers: { 'if-none-match': '"x"' }, passStatuses: [304, 403] }
    const notModified = await fetchCapped(`${HOST}/sha`, options(fn, extra))
    expect(notModified).toMatchObject({ ok: true, status: 304 })
    if (notModified.ok) expect(notModified.headers.get('etag')).toBe('"x"')
    expect(new Headers(asked[0]?.init?.headers).get('if-none-match')).toBe('"x"')
    const limited = await fetchCapped(`${HOST}/limit`, options(fn, extra))
    expect(limited.ok && limited.headers.get('x-ratelimit-remaining')).toBe('0')
  })

  it('refuses a body over the cap by its header, without reading it', async () => {
    const { fn } = table({ '/big': () => new Response('x', { headers: { 'content-length': '17' } }) })
    expect(await fetchCapped(`${HOST}/big`, options(fn))).toEqual({ ok: false, problem: 'too-large' })
  })

  it('refuses a body over the cap as it streams, when no length is sent', async () => {
    const chunks = ['0123456789', '0123456789']
    const body = () =>
      new Response(
        new ReadableStream({
          start(controller) {
            for (const c of chunks) controller.enqueue(new TextEncoder().encode(c))
            controller.close()
          },
        }),
      )
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { fn } = table({ '/stream': body })
    expect(await fetchCapped(`${HOST}/stream`, options(fn))).toEqual({ ok: false, problem: 'too-large' })
  })

  it('reads an answer with no body as empty', async () => {
    const { fn } = table({ '/empty': () => new Response(null, { status: 204 }) })
    const answer = await fetchCapped(`${HOST}/empty`, options(fn))
    expect(answer).toMatchObject({ ok: true, status: 204 })
    if (answer.ok) expect(answer.body.length).toBe(0)
  })

  it('follows redirects on the same host, up to the limit', async () => {
    const { fn, asked } = table({
      '/one': redirect('/two'),
      '/two': redirect(`${HOST}/three`),
      '/three': () => new Response('{}'),
    })
    expect(await fetchCapped(`${HOST}/one`, options(fn))).toMatchObject({ ok: true })
    expect(asked.map((a) => new URL(a.url).pathname)).toEqual(['/one', '/two', '/three'])
  })

  it('refuses a third hop, a redirect to another host and one without a location', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const hops = table({ '/one': redirect('/two'), '/two': redirect('/three'), '/three': redirect('/four') })
    expect(await fetchCapped(`${HOST}/one`, options(hops.fn))).toEqual({ ok: false, problem: 'unavailable' })
    expect(hops.asked).toHaveLength(3)
    const away = table({ '/one': redirect('https://evil.example/one') })
    expect(await fetchCapped(`${HOST}/one`, options(away.fn))).toEqual({ ok: false, problem: 'unavailable' })
    expect(away.asked).toHaveLength(1)
    const nowhere = table({ '/one': () => new Response(null, { status: 301 }) })
    expect(await fetchCapped(`${HOST}/one`, options(nowhere.fn))).toEqual({ ok: false, problem: 'unavailable' })
    expect(errors).toHaveBeenCalled()
  })

  it('answers 404 as not found without logging, 429 and 503 as busy, and other errors as unavailable', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { fn } = table({
      '/limited': () => new Response('slow down', { status: 429 }),
      '/down': () => new Response('down', { status: 503 }),
      '/broken': () => new Response('broken', { status: 500 }),
    })
    expect(await fetchCapped(`${HOST}/gone`, options(fn))).toEqual({ ok: false, problem: 'not-found' })
    expect(errors).not.toHaveBeenCalled()
    expect(await fetchCapped(`${HOST}/limited`, options(fn))).toEqual({ ok: false, problem: 'busy' })
    expect(await fetchCapped(`${HOST}/down`, options(fn))).toEqual({ ok: false, problem: 'busy' })
    expect(await fetchCapped(`${HOST}/broken`, options(fn))).toEqual({ ok: false, problem: 'unavailable' })
  })

  it('logs only the part of the address the caller chooses', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { fn } = table({ '/api/rest_v1/page/definition/secret': () => new Response('x', { status: 500 }) })
    await fetchCapped(`${HOST}/api/rest_v1/page/definition/secret`, options(fn))
    const logged = errors.mock.calls.flat().join(' ')
    expect(logged).toContain('[service] Error: /api: unavailable')
    expect(logged).not.toContain('secret')
  })

  it('gives up at the deadline, and says it timed out', async () => {
    vi.useFakeTimers()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const hang = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })) as typeof fetch
    const pending = fetchCapped(`${HOST}/slow`, options(hang))
    await vi.advanceTimersByTimeAsync(1000)
    expect(await pending).toEqual({ ok: false, problem: 'unavailable' })
    expect(errors.mock.calls.flat().join(' ')).toContain('(timed out)')
  })

  it('stops when the caller’s signal aborts', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const stop = new AbortController()
    const hang = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })) as typeof fetch
    const pending = fetchCapped(`${HOST}/slow`, options(hang, { signal: stop.signal }))
    stop.abort()
    expect(await pending).toEqual({ ok: false, problem: 'unavailable' })
  })

  it('uses the global fetch when none is given', async () => {
    const global = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
    const { fetch: _unused, ...rest } = options(globalThis.fetch)
    expect(await fetchCapped(`${HOST}/x`, rest)).toMatchObject({ ok: true })
    expect(global).toHaveBeenCalledOnce()
  })
})
