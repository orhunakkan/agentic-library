import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResolvedAddress } from './address-guard'
import { fetchPage, fetchPicture, fixedLookup, looksLikeHtml, systemResolve, type WebFetchOptions } from './web-fetch'

type Handler = (req: IncomingMessage, res: ServerResponse) => void
let handler: Handler = (_req, res) => res.end()
let server: Server
let port = 0
const seen: string[] = []

beforeAll(async () => {
  server = createServer((req, res) => handler(req, res))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
})
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

const PUBLIC = '93.184.216.34'
let answers: Record<string, string[][]> = {}

beforeEach(() => {
  seen.length = 0
  answers = {}
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

const resolve = async (host: string): Promise<ResolvedAddress[]> => {
  const queue = answers[host]
  const next = queue && queue.length > 1 ? (queue.shift() as string[]) : (queue?.[0] ?? [PUBLIC])
  if (host === 'nowhere.test') throw new Error('ENOTFOUND nowhere.test')
  return next.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))
}

const options = (more: WebFetchOptions = {}): WebFetchOptions => ({
  resolve,
  connect: (checked) => {
    seen.push(checked.address)
    return { address: '127.0.0.1', family: 4, port }
  },
  ...more,
})

const html = (body = '<p>Hello</p>') => `<!doctype html><html><head><title>T</title></head><body>${body}</body></html>`
const page = (res: ServerResponse, body = html(), type = 'text/html; charset=utf-8') => {
  res.writeHead(200, { 'content-type': type })
  res.end(body)
}
const text = (r: Awaited<ReturnType<typeof fetchPage>>) => (r.ok ? new TextDecoder().decode(r.body) : r.problem)

describe('fetchPage', () => {
  it('fetches a page, sending Folio’s headers', async () => {
    let headers: IncomingMessage['headers'] = {}
    handler = (req, res) => {
      headers = req.headers
      page(res)
    }
    const result = await fetchPage('http://example.test/a?b=1', options({ userAgent: 'Folio (+http://localhost)' }))
    expect(result).toMatchObject({
      ok: true,
      finalUrl: 'http://example.test/a?b=1',
      contentType: 'text/html; charset=utf-8',
    })
    expect(text(result)).toContain('<p>Hello</p>')
    expect(headers['user-agent']).toBe('Folio (+http://localhost)')
    expect(headers.accept).toBe('text/html,application/xhtml+xml;q=0.9,*/*;q=0.1')
    expect(headers['accept-encoding']).toBe('gzip, deflate, br')
    expect(headers['accept-language']).toBe('en;q=0.8,*;q=0.5')
    expect(headers.cookie).toBeUndefined()
    expect(seen).toEqual([PUBLIC])
  })

  it('follows 5 redirects and refuses a 6th', async () => {
    handler = (req, res) => {
      const n = Number(new URL(req.url ?? '/', 'http://x').searchParams.get('n') ?? 0)
      const stop = Number(new URL(req.url ?? '/', 'http://x').searchParams.get('stop'))
      if (n < stop) {
        res.writeHead(n % 2 ? 301 : 302, { location: `/r?n=${n + 1}&stop=${stop}` })
        res.end()
      } else page(res)
    }
    const five = await fetchPage('http://example.test/r?n=0&stop=5', options())
    expect(five).toMatchObject({ ok: true, finalUrl: 'http://example.test/r?n=5&stop=5' })
    expect(await fetchPage('http://example.test/r?n=0&stop=6', options())).toEqual({
      ok: false,
      problem: 'too_many_redirects',
    })
  })

  it('checks every hop of a redirect again', async () => {
    const to = (location: string) => {
      handler = (_req, res) => {
        res.writeHead(307, { location })
        res.end()
      }
    }
    for (const location of [
      'http://127.0.0.1:5432/',
      'http://10.0.0.1/',
      'http://[::ffff:127.0.0.1]/',
      'http://0x7f.1/',
      'http://2130706433/',
      'http://169.254.169.254/latest/meta-data/',
      'http://localhost/',
      'https://dev.agenticlibrary.app/',
    ]) {
      to(location)
      expect(await fetchPage('http://example.test/r', options()), location).toEqual({ ok: false, problem: 'blocked' })
    }
    to('ftp://example.test/x')
    expect(await fetchPage('http://example.test/r', options())).toEqual({ ok: false, problem: 'unavailable' })
    handler = (_req, res) => {
      res.writeHead(302)
      res.end()
    }
    expect(await fetchPage('http://example.test/r', options())).toEqual({ ok: false, problem: 'unavailable' })
    to('http://[bad')
    expect(await fetchPage('http://example.test/r', options())).toEqual({ ok: false, problem: 'unavailable' })
  })

  it('connects only to the address it checked, so a changed DNS answer is caught on the next hop (rebinding)', async () => {
    answers['rebind.test'] = [[PUBLIC], ['10.0.0.5']]
    handler = (req, res) => {
      if (req.url === '/first') {
        res.writeHead(302, { location: '/second' })
        res.end()
      } else page(res)
    }
    expect(await fetchPage('http://rebind.test/first', options())).toEqual({ ok: false, problem: 'blocked' })
    expect(seen).toEqual([PUBLIC])
  })

  it('refuses a host with one private address among public ones', async () => {
    answers['mixed.test'] = [[PUBLIC, '10.0.0.1', '2606:4700::1111']]
    handler = (_req, res) => page(res)
    expect(await fetchPage('http://mixed.test/', options())).toEqual({ ok: false, problem: 'blocked' })
    answers['six.test'] = [['::1']]
    expect(await fetchPage('http://six.test/', options())).toEqual({ ok: false, problem: 'blocked' })
    answers['none.test'] = [[]]
    expect(await fetchPage('http://none.test/', options())).toEqual({ ok: false, problem: 'blocked' })
    expect(seen).toEqual([])
  })

  it('refuses a private literal before any request', async () => {
    expect(await fetchPage('http://127.0.0.1/', options())).toEqual({ ok: false, problem: 'blocked' })
    expect(await fetchPage('ftp://example.test/', options())).toEqual({ ok: false, problem: 'unavailable' })
    expect(seen).toEqual([])
  })

  it('lets a test host reach loopback', async () => {
    handler = (_req, res) => page(res)
    const result = await fetchPage(`http://127.0.0.1:${port}/x`, { testHosts: [`127.0.0.1:${port}`] })
    expect(result).toMatchObject({ ok: true, finalUrl: `http://127.0.0.1:${port}/x` })
  })

  it('decompresses gzip, deflate and brotli', async () => {
    const body = html('<p>Compressed</p>')
    for (const [encoding, bytes] of [
      ['gzip', gzipSync(body)],
      ['deflate', deflateSync(body)],
      ['br', brotliCompressSync(body)],
    ] as const) {
      handler = (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': encoding })
        res.end(bytes)
      }
      expect(text(await fetchPage('http://example.test/', options())), encoding).toContain('Compressed')
    }
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'zstd' })
      res.end('x')
    }
    expect(await fetchPage('http://example.test/', options())).toEqual({ ok: false, problem: 'unavailable' })
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' })
      res.end('not gzip at all')
    }
    expect(await fetchPage('http://example.test/', options())).toEqual({ ok: false, problem: 'unavailable' })
  })

  it('stops a compression bomb at the cap', async () => {
    const bomb = gzipSync(Buffer.alloc(6 * 1024 * 1024, 32))
    expect(bomb.length).toBeLessThan(10 * 1024)
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' })
      res.end(bomb)
    }
    expect(await fetchPage('http://example.test/', options())).toEqual({ ok: false, problem: 'too_large' })
  })

  it('refuses a page over 5 MB, by its length or by what arrives', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html', 'content-length': String(6 * 1024 * 1024) })
      res.end()
    }
    expect(await fetchPage('http://example.test/', options())).toEqual({ ok: false, problem: 'too_large' })
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(Buffer.alloc(5 * 1024 * 1024 + 1, 32))
    }
    expect(await fetchPage('http://example.test/', options())).toEqual({ ok: false, problem: 'too_large' })
  })

  it('gives up on a body that stalls, on headers that never come, and at the deadline', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.write('<html>')
    }
    expect(await fetchPage('http://example.test/', options({ timeouts: { stallMs: 50 } }))).toEqual({
      ok: false,
      problem: 'unavailable',
    })
    handler = () => {}
    expect(await fetchPage('http://example.test/', options({ timeouts: { headersMs: 50 } }))).toEqual({
      ok: false,
      problem: 'unavailable',
    })
    expect(await fetchPage('http://example.test/', options({ timeouts: { totalMs: 50 } }))).toEqual({
      ok: false,
      problem: 'unavailable',
    })
    const late = console.error as unknown as { mock: { calls: string[][] } }
    expect(late.mock.calls.at(-1)?.[0]).toContain('(timed out)')
  })

  it('stops when the reader goes away', async () => {
    handler = () => {}
    const controller = new AbortController()
    const pending = fetchPage('http://example.test/', options({ signal: controller.signal }))
    controller.abort()
    expect(await pending).toEqual({ ok: false, problem: 'unavailable' })
  })

  it('says what each status means', async () => {
    const cases: [number, string][] = [
      [404, 'page_not_found'],
      [410, 'page_not_found'],
      [401, 'refused'],
      [403, 'refused'],
      [451, 'refused'],
      [429, 'refused'],
      [500, 'unavailable'],
      [503, 'unavailable'],
      [304, 'unavailable'],
    ]
    for (const [status, problem] of cases) {
      handler = (_req, res) => {
        res.writeHead(status)
        res.end()
      }
      expect(await fetchPage('http://example.test/', options()), String(status)).toEqual({ ok: false, problem })
    }
  })

  it('refuses what isn’t a page', async () => {
    handler = (_req, res) => page(res, '%PDF-1.7', 'application/pdf')
    expect(await fetchPage('http://example.test/', options())).toEqual({ ok: false, problem: 'not_html' })
    handler = (_req, res) => {
      res.writeHead(200)
      res.end('just text')
    }
    expect(await fetchPage('http://example.test/', options())).toEqual({ ok: false, problem: 'not_html' })
  })

  it('takes a page with no Content-Type when its body is HTML', async () => {
    handler = (_req, res) => {
      res.removeHeader('content-type')
      res.writeHead(200)
      res.end(`﻿\n  ${html()}`)
    }
    const result = await fetchPage('http://example.test/', options())
    expect(result).toMatchObject({ ok: true, contentType: null })
  })

  it('accepts XHTML', async () => {
    handler = (_req, res) => page(res, html(), 'application/xhtml+xml')
    expect((await fetchPage('http://example.test/', options())).ok).toBe(true)
  })

  it('is unavailable when the name doesn’t resolve or nothing answers', async () => {
    expect(await fetchPage('http://nowhere.test/', options())).toEqual({ ok: false, problem: 'unavailable' })
    const closed = await fetchPage('http://example.test/', {
      resolve,
      connect: () => ({ address: '127.0.0.1', family: 4, port: 1 }),
    })
    expect(closed).toEqual({ ok: false, problem: 'unavailable' })
  })

  it('never logs the address or the host', async () => {
    handler = (_req, res) => {
      res.writeHead(500)
      res.end()
    }
    await fetchPage('http://secret-site.test/private-path', options())
    const logged = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.flat().join('\n')
    expect(logged).toContain('unavailable (500)')
    expect(logged).not.toContain('secret-site')
    expect(logged).not.toContain('private-path')
  })
})

describe('fetchPicture', () => {
  it('fetches any type (the caller sniffs it), asking for the pictures Folio keeps', async () => {
    let accept = ''
    handler = (req, res) => {
      accept = req.headers.accept ?? ''
      res.writeHead(200, { 'content-type': 'image/png' })
      res.end(Buffer.from([1, 2, 3]))
    }
    const result = await fetchPicture('http://example.test/p.png', options())
    expect(result).toMatchObject({ ok: true, contentType: 'image/png' })
    expect(result.ok && [...result.body]).toEqual([1, 2, 3])
    expect(accept).toBe('image/webp,image/png,image/jpeg,image/gif')
  })

  it('refuses a picture over 10 MB', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(11 * 1024 * 1024) })
      res.end()
    }
    expect(await fetchPicture('http://example.test/p.png', options())).toEqual({ ok: false, problem: 'too_large' })
  })
})

describe('looksLikeHtml', () => {
  it('knows a document by its start', () => {
    const bytes = (s: string) => new TextEncoder().encode(s)
    expect(looksLikeHtml(bytes('<!DOCTYPE html><p>'))).toBe(true)
    expect(looksLikeHtml(bytes('  <html lang="en">'))).toBe(true)
    expect(looksLikeHtml(bytes('﻿<html>'))).toBe(true)
    expect(looksLikeHtml(bytes('<htmlx>'))).toBe(false)
    expect(looksLikeHtml(bytes('{"json": true}'))).toBe(false)
  })
})

describe('fixedLookup', () => {
  it('answers only the checked address, alone or as a list', () => {
    const lookup = fixedLookup({ address: '93.184.216.34', family: 4 })
    const one = vi.fn()
    lookup('a.test', {}, one)
    expect(one).toHaveBeenCalledWith(null, '93.184.216.34', 4)
    const all = vi.fn()
    lookup('a.test', { all: true }, all)
    expect(all).toHaveBeenCalledWith(null, [{ address: '93.184.216.34', family: 4 }])
  })
})

describe('the system resolver', () => {
  it('gives every address of a name, each with its family', async () => {
    const addresses = await systemResolve('localhost')
    expect(addresses.length).toBeGreaterThan(0)
    for (const a of addresses)
      expect(a).toEqual({ address: expect.any(String), family: a.address.includes(':') ? 6 : 4 })
  })
  it('fails for a name that doesn’t exist', async () => {
    await expect(systemResolve('folio-test.invalid')).rejects.toThrow()
  })
})
