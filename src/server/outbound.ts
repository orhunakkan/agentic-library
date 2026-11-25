import '@tanstack/react-start/server-only'
import { getConfig } from './config.ts'
import { readCapped } from './json-body.ts'
import { logError } from './redact.ts'

export type OutboundProblem = 'busy' | 'unavailable' | 'not-found' | 'too-large'
export type OutboundResult =
  | { ok: true; status: number; body: Uint8Array; headers: Headers }
  | { ok: false; problem: OutboundProblem }

export interface OutboundOptions {
  accept: string
  maxBytes: number
  timeoutMs: number
  redirects: number
  allowRedirect: (target: URL) => boolean
  userAgent: string
  headers?: Record<string, string>
  passStatuses?: readonly number[]
  log: { label: string; path: (url: URL) => string }
  fetch?: typeof fetch
  signal?: AbortSignal
}

/** How Folio names itself to other sites: its origin, and a contact when one is configured. */
export function folioUserAgent(contact: string | null = null): string {
  const { appOrigin } = getConfig()
  return contact ? `Folio (${contact}; +${appOrigin})` : `Folio (+${appOrigin})`
}

/** Answers from another site by URL, each kept for `maxAgeMs`, and at most `max` of them, the oldest dropped first. */
export function answerCache(maxAgeMs: number, max: number) {
  const entries = new Map<string, { at: number; value: unknown }>()
  return {
    get(url: string): { value: unknown } | undefined {
      const hit = entries.get(url)
      if (!hit) return undefined
      if (Date.now() - hit.at > maxAgeMs) {
        entries.delete(url)
        return undefined
      }
      return { value: hit.value }
    },
    set(url: string, value: unknown): void {
      entries.delete(url)
      entries.set(url, { at: Date.now(), value })
      while (entries.size > max) entries.delete(entries.keys().next().value as string)
    },
    clear: () => entries.clear(),
  }
}

class Failure extends Error {
  constructor(readonly problem: OutboundProblem) {
    super(problem)
  }
}

/** The successful answer, its body read up to `max` bytes; a longer body is a too-large failure. */
async function okAnswer(response: Response, max: number): Promise<OutboundResult> {
  const bytes = await readCapped(response, max)
  if (!bytes) throw new Failure('too-large')
  return { ok: true, status: response.status, body: new Uint8Array(bytes), headers: response.headers }
}

export async function fetchCapped(url: string, options: OutboundOptions): Promise<OutboundResult> {
  const doFetch = options.fetch ?? fetch
  const deadline = new AbortController()
  const timer = setTimeout(() => deadline.abort(), options.timeoutMs)
  const signal = options.signal ? AbortSignal.any([deadline.signal, options.signal]) : deadline.signal
  let current = new URL(url)
  try {
    for (let hop = 0; ; hop++) {
      const response = await doFetch(current, {
        headers: { ...options.headers, 'user-agent': options.userAgent, accept: options.accept },
        redirect: 'manual',
        signal,
      })
      if (options.passStatuses?.includes(response.status)) return await okAnswer(response, options.maxBytes)
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel().catch(() => {})
        const location = response.headers.get('location')
        const next = location ? new URL(location, current) : null
        if (!next || hop >= options.redirects || !options.allowRedirect(next)) throw new Failure('unavailable')
        current = next
        continue
      }
      if (response.status === 404) {
        await response.body?.cancel().catch(() => {})
        return { ok: false, problem: 'not-found' }
      }
      if (response.status === 429 || response.status === 503) throw new Failure('busy')
      if (!response.ok) throw new Failure('unavailable')
      return await okAnswer(response, options.maxBytes)
    }
  } catch (error) {
    const problem = error instanceof Failure ? error.problem : 'unavailable'
    logError(
      options.log.label,
      new Error(`${options.log.path(current)}: ${problem}${deadline.signal.aborted ? ' (timed out)' : ''}`),
    )
    return { ok: false, problem }
  } finally {
    clearTimeout(timer)
  }
}
