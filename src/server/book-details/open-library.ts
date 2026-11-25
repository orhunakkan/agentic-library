import '@tanstack/react-start/server-only'
import { KB, MB } from '../../shared/import/limits.ts'
import { getConfig } from '../config.ts'
import { fetchCapped, folioUserAgent, type OutboundProblem } from '../outbound.ts'
import type { LookupQuery } from './input.ts'
import { MAX_MATCHES, type OpenLibraryMatch, parseSearch, parseWork } from './open-library-parse.ts'

export type OpenLibraryProblem = OutboundProblem
export type OpenLibraryResult<T> = { ok: true; value: T } | { ok: false; problem: OpenLibraryProblem }

export interface OpenLibraryOptions {
  fetch?: typeof fetch
}

const TIMEOUT_MS = 8000
const MAX_JSON_BYTES = 256 * KB
const MAX_IMAGE_BYTES = 1 * MB
const MAX_REDIRECTS = 2
const MAX_WAIT_MS = 5000
const CACHE_MS = 60 * 60_000
const CACHE_MAX = 200

export const spacing = () => (getConfig().openLibraryContact ? 334 : 1000)

let nextStart = 0
const cache = new Map<string, { at: number; value: unknown }>()

export function resetOpenLibrary(): void {
  nextStart = 0
  cache.clear()
}

async function takeTurn(): Promise<boolean> {
  const now = Date.now()
  const start = Math.max(now, nextStart)
  if (start - now > MAX_WAIT_MS) return false
  nextStart = start + spacing()
  if (start > now) await new Promise((resolve) => setTimeout(resolve, start - now))
  return true
}

function cached(url: string): unknown {
  const hit = cache.get(url)
  if (!hit) return undefined
  if (Date.now() - hit.at > CACHE_MS) {
    cache.delete(url)
    return undefined
  }
  return hit.value
}

function remember(url: string, value: unknown): void {
  cache.delete(url)
  cache.set(url, { at: Date.now(), value })
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string)
}

function allowedRedirect(target: URL): boolean {
  const { openLibraryBase, openLibraryCoversBase } = getConfig()
  for (const base of [openLibraryBase, openLibraryCoversBase]) {
    const b = new URL(base)
    if (target.protocol === b.protocol && target.host === b.host) return true
  }
  return target.protocol === 'https:' && (target.hostname === 'archive.org' || target.hostname.endsWith('.archive.org'))
}

async function request(
  url: string,
  accept: string,
  max: number,
  options: OpenLibraryOptions,
): Promise<OpenLibraryResult<Uint8Array>> {
  if (!(await takeTurn())) return { ok: false, problem: 'busy' }
  const answer = await fetchCapped(url, {
    accept,
    maxBytes: max,
    timeoutMs: TIMEOUT_MS,
    redirects: MAX_REDIRECTS,
    allowRedirect: allowedRedirect,
    userAgent: folioUserAgent(getConfig().openLibraryContact),
    log: { label: 'open library', path: (at) => at.pathname },
    fetch: options.fetch,
  })
  return answer.ok ? { ok: true, value: answer.body } : answer
}

async function getJson(url: string, options: OpenLibraryOptions): Promise<OpenLibraryResult<unknown>> {
  const hit = cached(url)
  if (hit !== undefined) return { ok: true, value: hit }
  const body = await request(url, 'application/json', MAX_JSON_BYTES, options)
  if (!body.ok) return body
  try {
    const value: unknown = JSON.parse(Buffer.from(body.value).toString('utf8'))
    remember(url, value)
    return { ok: true, value }
  } catch {
    return { ok: false, problem: 'unavailable' }
  }
}

export async function search(
  query: LookupQuery,
  options: OpenLibraryOptions = {},
): Promise<OpenLibraryResult<OpenLibraryMatch[]>> {
  const params = new URLSearchParams()
  if (query.by === 'isbn') params.set('q', `isbn:${query.isbn}`)
  else {
    params.set('title', query.title)
    if (query.author) params.set('author', query.author)
  }
  params.set('fields', 'key,title,author_name,first_publish_year,cover_i')
  params.set('limit', String(MAX_MATCHES))
  const answer = await getJson(`${getConfig().openLibraryBase}/search.json?${params}`, options)
  return answer.ok ? { ok: true, value: parseSearch(answer.value) } : answer
}

export async function work(
  id: string,
  options: OpenLibraryOptions = {},
): Promise<OpenLibraryResult<{ description: string | null }>> {
  const answer = await getJson(`${getConfig().openLibraryBase}/works/${id}.json`, options)
  return answer.ok ? { ok: true, value: parseWork(answer.value) } : answer
}

export function cover(coverId: number, options: OpenLibraryOptions = {}): Promise<OpenLibraryResult<Uint8Array>> {
  return request(
    `${getConfig().openLibraryCoversBase}/b/id/${coverId}-L.jpg?default=false`,
    'image/*',
    MAX_IMAGE_BYTES,
    options,
  )
}

export const thumbUrl = (coverId: number) => `${getConfig().openLibraryCoversBase}/b/id/${coverId}-M.jpg`
