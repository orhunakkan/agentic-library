import { describe, expect, it } from 'vitest'
import { ANTHROPIC_VERSION, checkAnthropicKey, isAnthropicKeyShape } from '~/server/anthropic'

const KEY = 'sk-ant-api03-example-key-0123456789'
const respond = (status: number) => async () => new Response('{}', { status })

describe('isAnthropicKeyShape', () => {
  it('wants sk-ant-, 20–300 characters and no whitespace', () => {
    expect(isAnthropicKeyShape(KEY)).toBe(true)
    expect(isAnthropicKeyShape('sk-ant-short')).toBe(false)
    expect(isAnthropicKeyShape(`sk-ant-${'a'.repeat(294)}`)).toBe(false)
    expect(isAnthropicKeyShape('sk-ant-api03 with spaces inside')).toBe(false)
    expect(isAnthropicKeyShape('sk-proj-0123456789abcdefghij')).toBe(false)
  })
})

describe('checkAnthropicKey', () => {
  it('sends the key and version headers to /v1/models', async () => {
    let seen: { url: string; headers: Record<string, string> } | undefined
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen = { url, headers: init.headers as Record<string, string> }
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    expect(await checkAnthropicKey(KEY, 'https://api.example', fetchFn)).toEqual({ result: 'valid', status: 200 })
    expect(seen?.url).toBe('https://api.example/v1/models?limit=1')
    expect(seen?.headers).toEqual({ 'x-api-key': KEY, 'anthropic-version': ANTHROPIC_VERSION })
  })

  it('maps 401 and 403 to rejected, anything else to unavailable', async () => {
    const f = (status: number) => respond(status) as unknown as typeof fetch
    expect((await checkAnthropicKey(KEY, 'x', f(401))).result).toBe('rejected')
    expect((await checkAnthropicKey(KEY, 'x', f(403))).result).toBe('rejected')
    expect((await checkAnthropicKey(KEY, 'x', f(429))).result).toBe('unavailable')
    expect((await checkAnthropicKey(KEY, 'x', f(500))).result).toBe('unavailable')
    const failing = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    expect(await checkAnthropicKey(KEY, 'x', failing)).toEqual({ result: 'unavailable' })
  })
})
