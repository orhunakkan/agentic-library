import Anthropic from '@anthropic-ai/sdk'

export const ANTHROPIC_VERSION = '2026-10-21'
const TIMEOUT_MS = 10_000

export type KeyCheck = 'valid' | 'rejected' | 'unavailable'

export async function checkAnthropicKey(
  key: string,
  apiBase: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ result: KeyCheck; status?: number }> {
  try {
    const response = await fetchFn(`${apiBase}/v1/models?limit=1`, {
      headers: { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'error',
    })
    await response.body?.cancel().catch(() => {})
    if (response.status === 200) return { result: 'valid', status: 200 }
    if (response.status === 401 || response.status === 403) return { result: 'rejected', status: response.status }
    return { result: 'unavailable', status: response.status }
  } catch {
    return { result: 'unavailable' }
  }
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
