import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(new URL(path, import.meta.url))
const json = (name: string) => JSON.parse(read(`./open-library/${name}.json`).toString('utf8')) as unknown

export const STUB_TITLES = {
  none: 'Nothing Matches This',
  busy: 'Open Library Busy',
  error: 'Open Library Error',
  slow: 'Open Library Slow',
  away: 'Open Library Away',
} as const

export const STUB_COVERS = { huge: 2, missing: 3, redirect: 4, away: 5 } as const

const SLOW_MS = 10_000

function waitOrAbort(ms: number, signal: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('aborted', 'AbortError'))
    })
  })
}

const image = (name: string) =>
  new Response(new Uint8Array(read(`../../fixtures/images/${name}`)), { headers: { 'content-type': 'image/jpeg' } })

export async function openLibraryStub(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const at = url.pathname.search(/\/(api|covers)\//)
  if (at < 0) return new Response('Not found', { status: 404 })
  const [, kind, rest] = /^\/(api|covers)(\/.*)$/.exec(url.pathname.slice(at)) ?? []
  const fromServer = kind === 'api' || /-L\.jpg$/.test(rest ?? '')
  if (fromServer && !/^Folio \(/.test(request.headers.get('user-agent') ?? ''))
    return new Response('No User-Agent', { status: 400 })

  if (kind === 'api' && rest === '/search.json') {
    const q = url.searchParams.get('q')
    if (q?.startsWith('isbn:')) return Response.json(json('search-isbn'))
    switch (url.searchParams.get('title')) {
      case STUB_TITLES.none:
        return Response.json({ numFound: 0, docs: [] })
      case STUB_TITLES.busy:
        return new Response('Busy', { status: 503 })
      case STUB_TITLES.error:
        return new Response('Error', { status: 500 })
      case STUB_TITLES.slow:
        await waitOrAbort(SLOW_MS, request.signal)
        return Response.json({ docs: [] })
      case STUB_TITLES.away:
        return new Response(null, { status: 302, headers: { location: 'https://evil.example/search.json' } })
      default:
        return Response.json(json('search-title'))
    }
  }

  const workMatch = kind === 'api' ? /^\/works\/(OL\d+W)\.json$/.exec(rest ?? '') : null
  if (workMatch) {
    const id = workMatch[1] as string
    if (id === 'OL66554W') return Response.json(json('work-OL66554W'))
    if (id === 'OL404W') return new Response('Not found', { status: 404 })
    return Response.json({ key: `/works/${id}`, description: { type: '/type/text', value: `About the work ${id}.` } })
  }

  const coverMatch = kind === 'covers' ? /^\/b\/id\/(\d+)-([SML])\.jpg$/.exec(rest ?? '') : null
  if (coverMatch) {
    const id = Number(coverMatch[1])
    if (id === STUB_COVERS.missing) return new Response('Not found', { status: 404 })
    if (id === STUB_COVERS.huge) return image('huge.jpg')
    if (id === STUB_COVERS.redirect)
      return new Response(null, { status: 302, headers: { location: `1-${coverMatch[2]}.jpg` } })
    if (id === STUB_COVERS.away)
      return new Response(null, { status: 302, headers: { location: 'https://evil.example/cover.jpg' } })
    return image('cover.jpg')
  }
  return new Response('Not found', { status: 404 })
}
