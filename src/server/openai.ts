import '@tanstack/react-start/server-only'
import OpenAI from 'openai'
import type { AskErrorCode } from '../shared/ask/events.ts'
import { checkKeyAt } from './anthropic.ts'

export function checkOpenAiKey(key: string, apiBase: string, fetchFn: typeof fetch = fetch) {
  return checkKeyAt(`${apiBase}/v1/models`, { authorization: `Bearer ${key}` }, fetchFn)
}

export function isOpenAiKeyShape(key: string): boolean {
  return key.startsWith('sk-') && !key.startsWith('sk-ant-') && key.length >= 20 && key.length <= 300 && !/\s/.test(key)
}

export interface OpenAiClientOptions {
  apiKey: string
  apiBase: string
  timeoutMs: number
  fetch?: typeof fetch
}

/** A client that sends the key only to the configured API base, reads nothing from the environment, and never logs. */
export function openAiClient({ apiKey, apiBase, timeoutMs, fetch: doFetch }: OpenAiClientOptions): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: `${apiBase}/v1`,
    organization: null,
    project: null,
    webhookSecret: null,
    timeout: timeoutMs,
    logLevel: 'off',
    ...(doFetch ? { fetch: doFetch } : {}),
  })
}

/** The error a failed stream reports in its `response.failed` event, which the SDK passes on as an event. */
export class OpenAiResponseError extends Error {
  readonly code: string | null

  constructor(code: string | null) {
    super(`OpenAI response failed${code ? ` (${code})` : ''}`)
    this.name = 'OpenAiResponseError'
    this.code = code
  }
}

const TOO_LONG = /context[ _]length|context window|maximum context|too many tokens|input is too long/i
const BUSY_CODES = new Set(['rate_limit_exceeded', 'server_error', 'server_is_overloaded', 'slow_down'])
const BILLING_CODES = new Set(['insufficient_quota', 'billing_hard_limit_reached', 'billing_not_active'])

function codeOf(code: string | null | undefined, type: string | null | undefined, message: string) {
  if ((code && BILLING_CODES.has(code)) || (type && BILLING_CODES.has(type))) return 'billing'
  if (code === 'context_length_exceeded' || TOO_LONG.test(message)) return 'too_long'
  if ((code && BUSY_CODES.has(code)) || type === 'server_error') return 'busy'
  return null
}

export function openAiErrorCode(error: unknown): Exclude<AskErrorCode, 'bad_format'> | null {
  if (error instanceof OpenAI.APIUserAbortError) return null
  if (error instanceof OpenAiResponseError) return codeOf(error.code, null, '') ?? 'failed'
  if (!(error instanceof OpenAI.APIError)) return 'failed'
  const status = error.status
  if (status === 401 || status === 403) return 'key_rejected'
  if (status === 402) return 'billing'
  if (status === 413) return 'too_long'
  const known = codeOf(error.code, error.type, error.message)
  if (status === 429) return known === 'billing' ? 'billing' : 'busy'
  if (status === 400) return known === 'too_long' ? 'too_long' : 'failed'
  if (status !== undefined && status >= 500) return 'busy'
  if (status === undefined && !(error instanceof OpenAI.APIConnectionError)) return known ?? 'failed'
  return 'failed'
}
