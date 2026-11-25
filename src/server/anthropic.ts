import Anthropic from '@anthropic-ai/sdk'

export const ANTHROPIC_VERSION = '2026-10-21'
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01'
const TIMEOUT_MS = 10_000

export type KeyCheck = 'valid' | 'rejected' | 'unavailable'

/** Asks a provider's model list whether it takes a key: 200 is valid, 401 or 403 rejected, anything else unavailable. */
export async function checkKeyAt(
  url: string,
  headers: Record<string, string>,
  fetchFn: typeof fetch,
): Promise<{ result: KeyCheck; status?: number }> {
  try {
    const response = await fetchFn(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' })
    await response.body?.cancel().catch(() => {})
    if (response.status === 200) return { result: 'valid', status: 200 }
    if (response.status === 401 || response.status === 403) return { result: 'rejected', status: response.status }
    return { result: 'unavailable', status: response.status }
  } catch {
    return { result: 'unavailable' }
  }
}

export function checkAnthropicKey(key: string, apiBase: string, fetchFn: typeof fetch = fetch) {
  const headers = { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION }
  return checkKeyAt(`${apiBase}/v1/models?limit=1`, headers, fetchFn)
}

export function isAnthropicKeyShape(key: string): boolean {
  return key.startsWith('sk-ant-') && key.length >= 20 && key.length <= 300 && !/\s/.test(key)
}

/** A client that sends the key only to the configured API base and never logs. */
export function anthropicClient({
  apiKey,
  apiBase,
  fetch: doFetch,
}: {
  apiKey: string
  apiBase: string
  fetch?: typeof fetch
}): Anthropic {
  return new Anthropic({
    apiKey,
    baseURL: apiBase,
    defaultHeaders: { 'anthropic-version': ANTHROPIC_VERSION },
    logLevel: 'off',
    openTelemetry: false,
    ...(doFetch ? { fetch: doFetch } : {}),
  })
}
