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

class Failure extends Error {
  constructor(readonly problem: OutboundProblem) {
    super(problem)
  }
}

async function readUpTo(response: Response, max: number): Promise<Uint8Array> {
  const bytes = await readCapped(response, max)
  if (!bytes) throw new Failure('too-large')
  return new Uint8Array(bytes)
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
      if (options.passStatuses?.includes(response.status))
        return {
          ok: true,
          status: response.status,
          body: await readUpTo(response, options.maxBytes),
          headers: response.headers,
        }
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
      return {
        ok: true,
        status: response.status,
        body: await readUpTo(response, options.maxBytes),
        headers: response.headers,
      }
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
