import '@tanstack/react-start/server-only'
import { KB } from '../../shared/import/limits.ts'
import { getConfig } from '../config.ts'
import { fetchCapped } from '../outbound.ts'
import { type ParsedDefinition, type ParsedSummary, parseDefinition, parseSummary } from './wikimedia-parse.ts'

export type WikimediaProblem = 'busy' | 'unavailable'
export type WikimediaResult<T> = { ok: true; value: T } | { ok: false; problem: WikimediaProblem }

export interface WikimediaOptions {
  fetch?: typeof fetch
  signal?: AbortSignal
}

const TIMEOUT_MS = 6000
const MAX_JSON_BYTES = 512 * KB
const MAX_REDIRECTS = 2
export const MAX_IN_FLIGHT = 8
const CACHE_MS = 6 * 60 * 60_000
const CACHE_MAX = 1000

export function userAgent(): string {
  const { appOrigin, wikimediaContact } = getConfig()
  return wikimediaContact ? `Folio (${wikimediaContact}; +${appOrigin})` : `Folio (+${appOrigin})`
}

const titlePath = (term: string) => encodeURIComponent(term.replaceAll(' ', '_'))

const wikipediaBase = (lang: string) => getConfig().wikipediaBase.replace('{lang}', lang)

export const wiktionaryPage = (term: string) => `${getConfig().wiktionaryBase}/wiki/${titlePath(term)}`

export const wikipediaSearch = (term: string, lang: string) =>
  `${wikipediaBase(lang)}/w/index.php?${new URLSearchParams({ search: term })}`

let inFlight = 0
const cache = new Map<string, { at: number; value: unknown }>()

export function resetWikimedia(): void {
  inFlight = 0
  cache.clear()
}

export const requestsInFlight = () => inFlight

function cached(url: string): { value: unknown } | undefined {
  const hit = cache.get(url)
  if (!hit) return undefined
  if (Date.now() - hit.at > CACHE_MS) {
    cache.delete(url)
    return undefined
  }
  return { value: hit.value }
}

function remember(url: string, value: unknown): void {
  cache.delete(url)
  cache.set(url, { at: Date.now(), value })
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string)
}

async function getParsed<T>(
  url: string,
  parse: (json: unknown) => T | null,
  options: WikimediaOptions,
): Promise<WikimediaResult<T | null>> {
  const hit = cached(url)
  if (hit) return { ok: true, value: hit.value as T | null }
  if (inFlight >= MAX_IN_FLIGHT) return { ok: false, problem: 'busy' }
  const origin = new URL(url)
  inFlight++
  try {
    const answer = await fetchCapped(url, {
      accept: 'application/json',
      maxBytes: MAX_JSON_BYTES,
      timeoutMs: TIMEOUT_MS,
      redirects: MAX_REDIRECTS,
      allowRedirect: (target) => target.protocol === origin.protocol && target.host === origin.host,
      userAgent: userAgent(),
      log: { label: 'wikimedia', path: (at) => at.pathname.split('/').slice(0, 3).join('/') },
      fetch: options.fetch,
      signal: options.signal,
    })
    if (!answer.ok) {
      if (answer.problem !== 'not-found')
        return { ok: false, problem: answer.problem === 'busy' ? 'busy' : 'unavailable' }
      remember(url, null)
      return { ok: true, value: null }
    }
    let json: unknown
    try {
      json = JSON.parse(Buffer.from(answer.body).toString('utf8'))
    } catch {
      return { ok: false, problem: 'unavailable' }
    }
    const value = parse(json)
    remember(url, value)
    return { ok: true, value }
  } finally {
    inFlight--
  }
}

export interface DefinitionLookup {
  term: string
  entry: ParsedDefinition | null
  retried: boolean
}

export async function definition(
  term: string,
  lang: string,
  options: WikimediaOptions = {},
): Promise<WikimediaResult<DefinitionLookup>> {
  const ask = (t: string) =>
    getParsed(
      `${getConfig().wiktionaryBase}/api/rest_v1/page/definition/${titlePath(t)}`,
      (json) => parseDefinition(json, lang),
      options,
    )
  const first = await ask(term)
  if (!first.ok) return first
  const lower = term.toLowerCase()
  const capitalised = /^\p{Lu}/u.test(term) && lower !== term
  if (first.value || !capitalised) return { ok: true, value: { term, entry: first.value, retried: false } }
  const second = await ask(lower)
  if (!second.ok) return second
  return { ok: true, value: { term: second.value ? lower : term, entry: second.value, retried: true } }
}

export function summary(
  title: string,
  lang: string,
  options: WikimediaOptions = {},
): Promise<WikimediaResult<ParsedSummary | null>> {
  return getParsed(
    `${wikipediaBase(lang)}/api/rest_v1/page/summary/${titlePath(title)}`,
    (json) => parseSummary(json, lang),
    options,
  )
}
