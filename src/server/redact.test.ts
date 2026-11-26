import { afterEach, describe, expect, it, vi } from 'vitest'
import { describeError, logError, redact } from './redact'

const KEY = 'sk-ant-api03-AbC_dEf-1234567890abcdefghijklmnopQRSTUV'

describe('redact', () => {
  it('masks Anthropic keys, x-api-key header values and bearer tokens', () => {
    expect(redact(`key ${KEY} here`)).toBe('key sk-ant-[redacted] here')
    expect(redact(`{"x-api-key":"${KEY}"}`)).not.toContain('AbC_dEf')
    expect(redact('x-api-key: abc123secret')).toBe('x-api-key: [redacted]')
    expect(redact('authorization: Bearer abc123secret')).toBe('authorization: Bearer [redacted]')
    expect(redact('{"Authorization":"Bearer abc123secret"}')).toBe('{"Authorization":"Bearer [redacted]"}')
    expect(redact("headers: { 'X-Api-Key': 'zzz-secret' }")).not.toContain('zzz-secret')
  })

  it('masks xi-api-key values, how ElevenLabs is sent a key', () => {
    const key = 'sk_0123456789abcdef0123456789abcdef0123456789abcdef'
    expect(redact(`xi-api-key: ${key}`)).toBe('xi-api-key: [redacted]')
    expect(redact(`{"xi-api-key":"${key}","content-type":"application/json"}`)).toBe(
      '{"xi-api-key":"[redacted]","content-type":"application/json"}',
    )
    expect(redact(`headers: { 'XI-API-KEY': '${key}' }`)).not.toContain(key)
  })

  it('masks the token in a mailed link, and only the token', () => {
    const token = 'Qm9vay1ib29rLWJvb2stYm9vay1ib29rLWJvb2stYm9v'
    expect(redact(`GET /confirm-email?token=${token} 500`)).toBe('GET /confirm-email?token=[redacted] 500')
    expect(redact(`https://agenticlibrary.app/reset-password?a=1&token=${token}#x`)).toBe(
      'https://agenticlibrary.app/reset-password?a=1&token=[redacted]#x',
    )
    expect(redact(`"next":"/confirm-email?TOKEN=${token}"`)).toBe('"next":"/confirm-email?TOKEN=[redacted]"')
    expect(redact('token_hash=abc csrf_token=keep')).toBe('token_hash=abc csrf_token=keep')
  })
})

describe('OpenAI keys', () => {
  it('are masked wherever they appear, project, service-account and legacy keys alike', () => {
    const project = `sk-proj-AbC_dEf-${'x'.repeat(40)}`
    const service = `sk-svcacct-${'y'.repeat(40)}`
    const legacy = `sk-${'Z9'.repeat(24)}`
    expect(redact(`key ${project} here`)).toBe('key sk-[redacted] here')
    expect(redact(`{"key":"${service}"}`)).toBe('{"key":"sk-[redacted]"}')
    expect(redact(`failed with ${legacy}.`)).toBe('failed with sk-[redacted].')
    expect(redact(`authorization: Bearer ${project}`)).toBe('authorization: Bearer [redacted]')
  })

  it('leave Anthropic’s mask, ElevenLabs’ sk_ keys and ordinary words alone', () => {
    expect(redact(`key ${KEY}`)).toBe('key sk-ant-[redacted]')
    expect(redact('task-0123456789abcdefghij and sk-short')).toBe('task-0123456789abcdefghij and sk-short')
  })
})

describe('describeError', () => {
  it('redacts thrown strings and objects, not only Errors', () => {
    expect(describeError(`failed with ${KEY}`)).toBe('failed with sk-ant-[redacted]')
    expect(describeError({ status: 401, key: KEY })).toBe('{"status":401,"key":"sk-ant-[redacted]"}')
  })

  it('says so when a thrown value cannot be printed, instead of throwing itself', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(describeError(circular)).toBe('[unprintable error]')
    expect(describeError(10n)).toBe('[unprintable error]')
  })

  it('uses the name and message when an Error has no stack', () => {
    const error = new RangeError(`out of range near ${KEY}`)
    error.stack = undefined
    expect(describeError(error)).toBe('RangeError: out of range near sk-ant-[redacted]')
  })

  it('follows at most five causes, so a cyclic chain still ends', () => {
    const error = new Error('outer')
    let link = error
    for (let i = 0; i < 10; i++) {
      const next = new Error(`cause ${i}`)
      link.cause = next
      link = next
    }
    link.cause = error
    const text = describeError(error)
    expect(text.match(/caused by:/g)).toHaveLength(5)
    expect(text.endsWith('caused by: …')).toBe(true)
  })
})

describe('logging a thrown fetch error', () => {
  afterEach(() => vi.restoreAllMocks())

  it('never writes the key, whether it is in the message, a cause or the headers', async () => {
    const lines: string[] = []
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void lines.push(args.join(' ')))
    const failingFetch = async (url: string, init: RequestInit) => {
      const headers = JSON.stringify(init.headers)
      throw new TypeError(`fetch failed: ${url} ${headers}`, {
        cause: new Error(`connect ECONNREFUSED while sending x-api-key: ${KEY}`),
      })
    }
    try {
      await failingFetch('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': KEY, 'anthropic-version': '2026-10-21' },
      })
    } catch (error) {
      logError(`checking ${KEY}`, error)
      expect(describeError(error)).not.toContain(KEY)
    }
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('fetch failed')
    expect(lines[0]).toContain('ECONNREFUSED')
    expect(lines[0]).not.toContain('AbC_dEf')
    expect(lines[0]).not.toContain('1234567890abcdefghijklmnop')
  })
})

describe('GitHub tokens', () => {
  it('masks a fine-grained and a classic token, wherever they appear', () => {
    const pat = `github_pat_11ABCDEFG0${'x'.repeat(70)}`
    const classic = 'ghp_0123456789abcdefghijABCDEFGHIJ012345'
    const text = redact(`using ${pat} and token ${classic}.`)
    expect(text).toBe('using github_pat_[redacted] and token ghp_[redacted].')
  })
})
