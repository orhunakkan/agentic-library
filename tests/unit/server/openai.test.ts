import OpenAI from 'openai'
import { describe, expect, it, vi } from 'vitest'
import { checkOpenAiKey, isOpenAiKeyShape, OpenAiResponseError, openAiClient, openAiErrorCode } from '~/server/openai'

const KEY = 'sk-proj-example-key-0123456789abcdef'
const respond = (status: number) => (async () => new Response('{}', { status })) as unknown as typeof fetch

describe('isOpenAiKeyShape', () => {
  it('wants sk-, 20–300 characters and no whitespace', () => {
    expect(isOpenAiKeyShape(KEY)).toBe(true)
    expect(isOpenAiKeyShape(`sk-svcacct-${'a'.repeat(40)}`)).toBe(true)
    expect(isOpenAiKeyShape(`sk-${'a'.repeat(48)}`)).toBe(true)
    expect(isOpenAiKeyShape('sk-short')).toBe(false)
    expect(isOpenAiKeyShape(`sk-${'a'.repeat(298)}`)).toBe(false)
    expect(isOpenAiKeyShape('sk-proj with spaces inside it')).toBe(false)
    expect(isOpenAiKeyShape(`sk_${'a'.repeat(40)}`)).toBe(false)
  })

  it('refuses an Anthropic key, though it starts with sk- too', () => {
    expect(isOpenAiKeyShape('sk-ant-api03-example-key-0123456789')).toBe(false)
  })
})

describe('checkOpenAiKey', () => {
  it('sends the key as a bearer token to /v1/models on the configured base', async () => {
    let seen: { url: string; headers: Record<string, string>; redirect?: string } | undefined
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen = { url, headers: init.headers as Record<string, string>, redirect: init.redirect }
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    expect(await checkOpenAiKey(KEY, 'https://api.example', fetchFn)).toEqual({ result: 'valid', status: 200 })
    expect(seen).toEqual({
      url: 'https://api.example/v1/models',
      headers: { authorization: `Bearer ${KEY}` },
      redirect: 'error',
    })
  })

  it('maps 401 and 403 to rejected, anything else to unavailable', async () => {
    expect(await checkOpenAiKey(KEY, 'x', respond(401))).toEqual({ result: 'rejected', status: 401 })
    expect(await checkOpenAiKey(KEY, 'x', respond(403))).toEqual({ result: 'rejected', status: 403 })
    expect(await checkOpenAiKey(KEY, 'x', respond(429))).toEqual({ result: 'unavailable', status: 429 })
    expect(await checkOpenAiKey(KEY, 'x', respond(500))).toEqual({ result: 'unavailable', status: 500 })
    const failing = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    expect(await checkOpenAiKey(KEY, 'x', failing)).toEqual({ result: 'unavailable' })
  })
})

describe('openAiClient', () => {
  it('sends requests to the configured base with the key, and no organization or project from the environment', async () => {
    vi.stubEnv('OPENAI_ORG_ID', 'org-from-env')
    vi.stubEnv('OPENAI_PROJECT_ID', 'proj-from-env')
    vi.stubEnv('OPENAI_BASE_URL', 'https://elsewhere.example/v1')
    let seen: { url: string; headers: Headers } | undefined
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen = { url: String(url), headers: new Headers(init.headers) }
      return Response.json({ object: 'list', data: [] })
    }) as unknown as typeof fetch
    const client = openAiClient({ apiKey: KEY, apiBase: 'https://api.example', timeoutMs: 1_000, fetch: fetchFn })
    await client.models.list()
    expect(seen?.url).toBe('https://api.example/v1/models')
    expect(seen?.headers.get('authorization')).toBe(`Bearer ${KEY}`)
    expect(seen?.headers.has('openai-organization')).toBe(false)
    expect(seen?.headers.has('openai-project')).toBe(false)
  })
})

const apiError = (status: number, error: object, message?: string) =>
  OpenAI.APIError.generate(status, { error }, message, new Headers())

/** How the SDK's stream reports an `error` event: an APIError without a status, built from the event's error. */
const streamError = (error: object) => new OpenAI.APIError(undefined, error, undefined, undefined)

describe('openAiErrorCode', () => {
  it('reads a rejected key from 401 and 403', () => {
    expect(openAiErrorCode(apiError(401, { type: 'invalid_request_error', code: 'invalid_api_key' }))).toBe(
      'key_rejected',
    )
    expect(openAiErrorCode(apiError(403, { type: 'invalid_request_error' }))).toBe('key_rejected')
  })

  it('reads an exhausted quota as billing, and any other 429 as busy', () => {
    expect(openAiErrorCode(apiError(429, { type: 'insufficient_quota', code: 'insufficient_quota' }))).toBe('billing')
    expect(openAiErrorCode(apiError(429, { type: 'requests', code: 'rate_limit_exceeded' }))).toBe('busy')
    expect(openAiErrorCode(apiError(402, {}))).toBe('billing')
  })

  it('reads 5xx as busy', () => {
    expect(openAiErrorCode(apiError(500, { type: 'server_error' }))).toBe('busy')
    expect(openAiErrorCode(apiError(503, {}))).toBe('busy')
  })

  it('reads a context-length refusal as too_long, and other 400s as failed', () => {
    const tooLong = { type: 'invalid_request_error', code: 'context_length_exceeded', message: 'too long' }
    expect(openAiErrorCode(apiError(400, tooLong))).toBe('too_long')
    const worded = {
      type: 'invalid_request_error',
      message: 'Your input exceeds the context window of this model.',
    }
    expect(openAiErrorCode(apiError(400, worded, worded.message))).toBe('too_long')
    expect(openAiErrorCode(apiError(413, {}))).toBe('too_long')
    expect(openAiErrorCode(apiError(400, { type: 'invalid_request_error', code: 'unsupported_value' }))).toBe('failed')
  })

  it('reads errors sent inside the stream by their code', () => {
    expect(openAiErrorCode(streamError({ code: 'rate_limit_exceeded', message: 'slow down' }))).toBe('busy')
    expect(openAiErrorCode(streamError({ code: 'insufficient_quota' }))).toBe('billing')
    expect(openAiErrorCode(streamError({ code: 'context_length_exceeded' }))).toBe('too_long')
    expect(openAiErrorCode(streamError({ code: 'invalid_prompt' }))).toBe('failed')
    expect(openAiErrorCode(new OpenAiResponseError('server_error'))).toBe('busy')
    expect(openAiErrorCode(new OpenAiResponseError(null))).toBe('failed')
  })

  it('reads a stopped request as nothing to report, and anything else as failed', () => {
    expect(openAiErrorCode(new OpenAI.APIUserAbortError())).toBeNull()
    expect(openAiErrorCode(new OpenAI.APIConnectionError({ message: 'socket hang up' }))).toBe('failed')
    expect(openAiErrorCode(new TypeError('boom'))).toBe('failed')
  })
})
