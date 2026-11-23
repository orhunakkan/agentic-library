import { type ArticleUrlProblem, MAX_ARTICLE_URL_LENGTH } from './contract.ts'
import { blockedAddress } from './ranges.ts'

export type ArticleUrlResult = { ok: true; url: URL } | { ok: false; reason: ArticleUrlProblem }

export interface ArticleUrlOptions {
  ownHosts?: readonly string[]
  testHosts?: readonly string[]
}

export const FOLIO_DOMAIN = 'agenticlibrary.app'

const LOCAL_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa']

function isLocalName(host: string): boolean {
  if (host === 'localhost' || !host.includes('.')) return true
  return LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix) || host === suffix.slice(1))
}

const within = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`)

function withScheme(input: string): string {
  if (input.startsWith('//')) return `https:${input}`
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(input)
  if (scheme && !/^\d/.test(input.slice(scheme[0].length))) return input
  return `https://${input}`
}

export const portOf = (url: URL) => url.port || (url.protocol === 'https:' ? '443' : '80')

const bareHost = (url: URL) => url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '')

export function isTestHost(url: URL, testHosts: readonly string[] = []): boolean {
  return testHosts.includes(`${url.hostname}:${portOf(url)}`)
}

export function parseArticleUrl(raw: string, options: ArticleUrlOptions = {}): ArticleUrlResult {
  const input = raw.trim()
  if (!input) return { ok: false, reason: 'empty' }
  if (input.length > MAX_ARTICLE_URL_LENGTH) return { ok: false, reason: 'too_long' }
  let url: URL
  try {
    url = new URL(withScheme(input))
  } catch {
    return { ok: false, reason: 'not_url' }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, reason: 'scheme' }
  if (url.username || url.password) return { ok: false, reason: 'credentials' }
  if (!url.hostname) return { ok: false, reason: 'not_url' }
  if (isTestHost(url, options.testHosts)) return { ok: true, url }
  if (!['80', '443'].includes(portOf(url))) return { ok: false, reason: 'port' }
  const host = bareHost(url)
  const literal = blockedAddress(host)
  if (literal === true) return { ok: false, reason: 'private_host' }
  if (literal === null && isLocalName(host)) return { ok: false, reason: 'private_host' }
  const own = [FOLIO_DOMAIN, ...(options.ownHosts ?? [])].map((h) => h.toLowerCase())
  if (own.some((domain) => within(host, domain))) return { ok: false, reason: 'own_site' }
  return { ok: true, url }
}

const TRACKING = new Set(['fbclid', 'gclid', 'dclid', 'msclkid', 'mc_cid', 'mc_eid', 'igshid', 'ref_src'])
const isTracking = (name: string) => name.toLowerCase().startsWith('utm_') || TRACKING.has(name.toLowerCase())

function decodedName(pair: string): string {
  const name = pair.split('=')[0] ?? ''
  try {
    return decodeURIComponent(name.replace(/\+/g, ' '))
  } catch {
    return name
  }
}

export function canonicalArticleUrl(address: URL | string): string {
  const url = new URL(address)
  url.hash = ''
  const kept = url.search
    .slice(1)
    .split('&')
    .filter((pair) => pair && !isTracking(decodedName(pair)))
  url.search = kept.length ? `?${kept.join('&')}` : ''
  return url.href
}
