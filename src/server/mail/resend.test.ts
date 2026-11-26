import { describe, expect, it, vi } from 'vitest'
import { type OutgoingMail, sendWithResend } from './resend'

const settings = {
  from: 'Folio <no-reply@agenticlibrary.app>',
  apiKey: 're_test_key_123',
  apiBase: 'https://resend.test',
}
const LINK = 'https://agenticlibrary.app/confirm-email?token=secret-token-value'
const mail: OutgoingMail = {
  to: 'ann@example.com',
  kind: 'confirm',
  subject: 'Confirm your email address for Folio',
  text: `Open this link:\n\n${LINK}`,
}

const answer = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })

const logged = () => vi.spyOn(console, 'error').mockImplementation(() => {})

describe('sendWithResend', () => {
  it('posts the message as plain text with the kind tag', async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => answer(200, { id: 'e-1' }))
    expect(await sendWithResend(settings, mail, { fetch })).toBe('sent')
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe('https://resend.test/emails')
    expect(init?.method).toBe('POST')
    expect(init?.redirect).toBe('error')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    expect(init?.headers).toEqual({ authorization: 'Bearer re_test_key_123', 'content-type': 'application/json' })
    const body = JSON.parse(String(init?.body))
    expect(body).toEqual({
      from: 'Folio <no-reply@agenticlibrary.app>',
      to: ['ann@example.com'],
      subject: 'Confirm your email address for Folio',
      text: mail.text,
      tags: [{ name: 'kind', value: 'confirm' }],
    })
    expect(Object.keys(body)).not.toContain('html')
  })

  it('reads 400 and 422 as invalid', async () => {
    const log = logged()
    for (const [status, name] of [
      [400, 'validation_error'],
      [422, 'validation_error'],
      [422, 'missing_required_field'],
    ] as const) {
      const fetch = async () => answer(status, { statusCode: status, name, message: 'Invalid `to` field.' })
      expect(await sendWithResend(settings, mail, { fetch })).toBe('invalid')
    }
    expect(log.mock.calls.map((c) => c[0])).toEqual([
      '[mail] confirm through Resend: invalid (400 validation_error)',
      '[mail] confirm through Resend: invalid (422 validation_error)',
      '[mail] confirm through Resend: invalid (422 missing_required_field)',
    ])
  })

  it('reads every 429 as busy', async () => {
    logged()
    for (const name of ['rate_limit_exceeded', 'daily_quota_exceeded', 'monthly_quota_exceeded']) {
      const fetch = async () => answer(429, { statusCode: 429, name, message: 'Too many.' })
      expect(await sendWithResend(settings, mail, { fetch }), name).toBe('busy')
    }
  })

  it('reads anything else, a timeout and an oversized answer as unavailable', async () => {
    const log = logged()
    for (const status of [401, 403, 500, 503]) {
      const fetch = async () => answer(status, { name: 'restricted_api_key', message: 'No.' })
      expect(await sendWithResend(settings, mail, { fetch }), String(status)).toBe('unavailable')
    }
    const timeout = async () => {
      throw new DOMException('The operation timed out.', 'TimeoutError')
    }
    expect(await sendWithResend(settings, mail, { fetch: timeout })).toBe('unavailable')
    const huge = async () => answer(200, 'x'.repeat(17 * 1024))
    expect(await sendWithResend(settings, mail, { fetch: huge })).toBe('unavailable')
    const declared = async () => answer(200, '{}', { 'content-length': String(20 * 1024) })
    expect(await sendWithResend(settings, mail, { fetch: declared })).toBe('unavailable')
    const garbled = async () => answer(500, '<html>oops</html>')
    expect(await sendWithResend(settings, mail, { fetch: garbled })).toBe('unavailable')
    const odd = async () => answer(500, { name: 'Not A Name <script>' })
    expect(await sendWithResend(settings, mail, { fetch: odd })).toBe('unavailable')
    const dropped = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new TypeError('terminated'))
          },
        }),
        { status: 200 },
      )
    expect(await sendWithResend(settings, mail, { fetch: dropped })).toBe('unavailable')
    const lines = log.mock.calls.map((c) => String(c[0]))
    expect(lines).toContain('[mail] confirm through Resend: unavailable (TypeError)')
    expect(lines).toContain('[mail] confirm through Resend: unavailable (TimeoutError)')
    expect(lines).toContain('[mail] confirm through Resend: unavailable (200 answer over 16 KB)')
    expect(lines).toContain('[mail] confirm through Resend: unavailable (500 unknown)')
  })

  it('never logs the address, the subject, the link or the key', async () => {
    const log = logged()
    const echo = async () => answer(422, { name: 'validation_error', message: `bad ${mail.to} ${LINK}` })
    await sendWithResend(settings, mail, { fetch: echo })
    const thrown = async () => {
      throw new Error(`failed for ${mail.to}`)
    }
    await sendWithResend(settings, mail, { fetch: thrown })
    const text = log.mock.calls.flat().join('\n')
    expect(text).not.toContain('ann@example.com')
    expect(text).not.toContain('secret-token-value')
    expect(text).not.toContain('Confirm your email')
    expect(text).not.toContain('re_test_key_123')
  })
})
