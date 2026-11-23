import '@tanstack/react-start/server-only'
import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import http, { type IncomingMessage } from 'node:http'
import https from 'node:https'
import { isIP, type LookupFunction } from 'node:net'
import type { Readable, Transform } from 'node:stream'
import zlib from 'node:zlib'
import { isTestHost, parseArticleUrl } from '../../shared/articles/article-url.ts'
import { MAX_PAGE_BYTES, MAX_PICTURE_BYTES, type WebFetchProblem } from '../../shared/articles/contract.ts'
import { logError } from '../redact.ts'
import { checkAddresses, type ResolvedAddress } from './address-guard.ts'

export type WebFetchResult =
  | { ok: true; finalUrl: string; body: Uint8Array; contentType: string | null }
  | { ok: false; problem: WebFetchProblem }

export interface WebFetchOptions {
  signal?: AbortSignal
  ownHosts?: readonly string[]
  testHosts?: readonly string[]
  userAgent?: string
  resolve?: (host: string) => Promise<ResolvedAddress[]>
  timeouts?: Partial<Timeouts>
  connect?: (checked: ResolvedAddress) => ResolvedAddress & { port: number }
}

interface Timeouts {
  totalMs: number
  headersMs: number
  stallMs: number
}

export const TIMEOUTS: Timeouts = { totalMs: 15_000, headersMs: 8_000, stallMs: 5_000 }
export const MAX_REDIRECTS = 5

const PAGE_ACCEPT = 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1'
const PICTURE_ACCEPT = 'image/webp,image/png,image/jpeg,image/gif'

class Failure extends Error {
  constructor(
    readonly problem: WebFetchProblem,
    readonly status?: number,
  ) {
    super(problem)
  }
}

export function systemResolve(host: string): Promise<ResolvedAddress[]> {
  return new Promise((resolve, reject) =>
    dnsLookup(host, { all: true, order: 'verbatim' }, (error, addresses: LookupAddress[]) =>
      error ? reject(error) : resolve(addresses.map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }))),
    ),
  )
}

const bareHost = (url: URL) => url.hostname.replace(/^\[|\]$/g, '')

async function addressesOf(url: URL, resolve: WebFetchOptions['resolve']): Promise<ResolvedAddress[]> {
  const host = bareHost(url)
  const family = isIP(host)
  if (family) return [{ address: host, family: family === 6 ? 6 : 4 }]
  try {
    return await (resolve ?? systemResolve)(host.replace(/\.$/, ''))
  } catch {
    throw new Failure('unavailable')
  }
}

export function fixedLookup(chosen: ResolvedAddress): LookupFunction {
  return (_host, options, callback) => {
    if ((options as { all?: boolean }).all) callback(null, [{ address: chosen.address, family: chosen.family }])
    else callback(null, chosen.address, chosen.family)
  }
}

const AGENTS = {
  'http:': new http.Agent({ keepAlive: false }),
  'https:': new https.Agent({ keepAlive: false }),
}

function request(
  url: URL,
  chosen: ResolvedAddress & { port?: number },
  accept: string,
  userAgent: string,
  signal: AbortSignal,
  headersMs: number,
): Promise<IncomingMessage> {
  const host = bareHost(url)
  const secure = url.protocol === 'https:'
  return new Promise((resolve, reject) => {
    const req = (secure ? https : http).request({
      protocol: url.protocol,
      host,
      port: chosen.port ?? (url.port || (secure ? 443 : 80)),
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      agent: AGENTS[secure ? 'https:' : 'http:'],
      lookup: fixedLookup(chosen),
      ...(secure && !isIP(host) ? { servername: host.replace(/\.$/, '') } : {}),
      signal,
      headers: {
        'user-agent': userAgent,
        accept,
        'accept-language': 'en;q=0.8,*;q=0.5',
        'accept-encoding': 'gzip, deflate, br',
      },
    })
    const timer = setTimeout(() => req.destroy(new Failure('unavailable')), headersMs)
    req.once('response', (response) => {
      clearTimeout(timer)
      resolve(response)
    })
    req.once('error', (error) => {
      clearTimeout(timer)
      reject(error instanceof Failure ? error : new Failure('unavailable'))
    })
    req.end()
  })
}

function statusProblem(status: number): WebFetchProblem | null {
  if (status >= 200 && status < 300) return null
  if (status === 404 || status === 410) return 'page_not_found'
  if (status >= 400 && status < 500) return 'refused'
  return 'unavailable'
}

function decoderFor(encoding: string): Transform | null {
  if (encoding === 'gzip' || encoding === 'x-gzip') return zlib.createGunzip()
  if (encoding === 'deflate') return zlib.createInflate()
  if (encoding === 'br') return zlib.createBrotliDecompress()
  return null
}

function decoded(response: IncomingMessage): Readable | null {
  const encoding = (response.headers['content-encoding'] ?? 'identity').trim().toLowerCase()
  if (encoding === 'identity' || encoding === '') return response
  const decoder = decoderFor(encoding)
  if (!decoder) return null
  response.on('error', (error) => decoder.destroy(error))
  return response.pipe(decoder)
}

async function readBody(response: IncomingMessage, max: number, stallMs: number): Promise<Uint8Array> {
  const length = Number(response.headers['content-length'] ?? 0)
  if (!response.headers['content-encoding'] && length > max) throw new Failure('too_large')
  const stream = decoded(response)
  if (!stream) throw new Failure('unavailable')
  let timer: NodeJS.Timeout | undefined
  const stall = () => {
    clearTimeout(timer)
    timer = setTimeout(() => response.destroy(new Failure('unavailable')), stallMs)
  }
  response.on('data', stall)
  stall()
  const chunks: Buffer[] = []
  let size = 0
  try {
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      size += chunk.length
      if (size > max) throw new Failure('too_large')
      chunks.push(chunk)
    }
  } catch (error) {
    throw error instanceof Failure ? error : new Failure('unavailable')
  } finally {
    clearTimeout(timer)
    response.off('data', stall)
    response.destroy()
  }
  return new Uint8Array(Buffer.concat(chunks))
}

const HTML_TYPES = ['text/html', 'application/xhtml+xml']

const mediaType = (header: string | undefined) => header?.split(';')[0]?.trim().toLowerCase() || null

export function looksLikeHtml(bytes: Uint8Array): boolean {
  const start = new TextDecoder('latin1').decode(bytes.subarray(0, 512))
  return /^(?:\xef\xbb\xbf|\xfe\xff|\xff\xfe)?\s*(?:<!doctype\s+html|<html[\s>])/i.test(start)
}

function checkedUrl(address: string, options: WebFetchOptions): URL {
  const parsed = parseArticleUrl(address, options)
  if (parsed.ok) return parsed.url
  const inside = parsed.reason === 'private_host' || parsed.reason === 'own_site' || parsed.reason === 'port'
  throw new Failure(inside ? 'blocked' : 'unavailable')
}

function redirectTarget(location: string | undefined, from: URL, options: WebFetchOptions): URL {
  if (!location) throw new Failure('unavailable')
  let next: URL
  try {
    next = new URL(location, from)
  } catch {
    throw new Failure('unavailable')
  }
  return checkedUrl(next.href, options)
}

async function fetchWeb(address: string, kind: 'page' | 'picture', options: WebFetchOptions): Promise<WebFetchResult> {
  const timeouts = { ...TIMEOUTS, ...options.timeouts }
  const deadline = new AbortController()
  const timer = setTimeout(() => deadline.abort(), timeouts.totalMs)
  const signal = options.signal ? AbortSignal.any([deadline.signal, options.signal]) : deadline.signal
  const userAgent = options.userAgent ?? 'Folio'
  try {
    let current = checkedUrl(address, options)
    for (let hop = 0; ; hop++) {
      const addresses = await addressesOf(current, options.resolve)
      if (!isTestHost(current, options.testHosts) && !checkAddresses(addresses)) throw new Failure('blocked')
      const checked = addresses[0] as ResolvedAddress
      const chosen = options.connect ? options.connect(checked) : checked
      const accept = kind === 'page' ? PAGE_ACCEPT : PICTURE_ACCEPT
      const response = await request(current, chosen, accept, userAgent, signal, timeouts.headersMs)
      const status = response.statusCode ?? 0
      if (status >= 300 && status < 400 && status !== 304) {
        response.destroy()
        if (hop >= MAX_REDIRECTS) throw new Failure('too_many_redirects', status)
        current = redirectTarget(response.headers.location, current, options)
        continue
      }
      const problem = statusProblem(status)
      if (problem) {
        response.destroy()
        throw new Failure(problem, status)
      }
      const contentType = mediaType(response.headers['content-type'])
      if (kind === 'page' && contentType && !HTML_TYPES.includes(contentType)) {
        response.destroy()
        throw new Failure('not_html', status)
      }
      const body = await readBody(response, kind === 'page' ? MAX_PAGE_BYTES : MAX_PICTURE_BYTES, timeouts.stallMs)
      if (kind === 'page' && !contentType && !looksLikeHtml(body)) throw new Failure('not_html', status)
      return { ok: true, finalUrl: current.href, body, contentType: response.headers['content-type'] ?? null }
    }
  } catch (error) {
    const failure = error instanceof Failure ? error : new Failure('unavailable')
    if (failure.problem !== 'page_not_found') {
      const status = failure.status ? ` (${failure.status})` : ''
      const late = deadline.signal.aborted ? ' (timed out)' : ''
      logError(`article ${kind} fetch`, new Error(`${failure.problem}${status}${late}`))
    }
    return { ok: false, problem: failure.problem }
  } finally {
    clearTimeout(timer)
  }
}

export function fetchPage(url: string, options: WebFetchOptions = {}): Promise<WebFetchResult> {
  return fetchWeb(url, 'page', options)
}

export function fetchPicture(url: string, options: WebFetchOptions = {}): Promise<WebFetchResult> {
  return fetchWeb(url, 'picture', options)
}
