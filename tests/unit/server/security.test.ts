import { describe, expect, it } from 'vitest'
import { clientIp, hashToken, isSameOrigin, isWellFormedToken, newSessionToken } from '~/server/security'
import { DEFAULT_AFTER_SIGN_IN, safeNext } from '~/shared/lib/safe-next'

describe('session tokens', () => {
  it('are 32 random bytes in base64url', () => {
    const token = newSessionToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(Buffer.from(token, 'base64url')).toHaveLength(32)
    expect(newSessionToken()).not.toBe(token)
    expect(isWellFormedToken(token)).toBe(true)
  })

  it('are stored as their SHA-256', () => {
    const hash = hashToken('abc')
    expect(hash.toString('hex')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(hashToken('abc').equals(hash)).toBe(true)
  })

  it('rejects anything that is not a token before it reaches the database', () => {
    for (const value of [undefined, null, '', 'short', `${'a'.repeat(43)}=`, `${'a'.repeat(42)}!`, 'a'.repeat(44)])
      expect(isWellFormedToken(value)).toBe(false)
  })
})

describe('safeNext', () => {
  it('follows same-site paths', () => {
    expect(safeNext('/account')).toBe('/account')
    expect(safeNext('/library/jane-austen?q=x#top')).toBe('/library/jane-austen?q=x#top')
  })

  it('ignores anything that could leave the site', () => {
    for (const next of [
      '//evil.example',
      '/\\evil.example',
      '/.//evil.example',
      '/a/..//evil.example',
      '/%2e//evil.example',
      '/%2e%2e//evil.example',
      'https://evil.example/',
      'javascript:alert(1)',
      'evil.example',
      '/%0d%0aLocation:x'.replace('%0d%0a', '\r\n'),
      '/\tevil',
      '',
      null,
      undefined,
      42,
      `/${'a'.repeat(1001)}`,
    ])
      expect(safeNext(next), String(next)).toBe(DEFAULT_AFTER_SIGN_IN)
  })
})

describe('isSameOrigin', () => {
  const app = 'https://agenticlibrary.app'
  const h = (init: Record<string, string>) => new Headers(init)

  it('accepts the app origin', () => {
    expect(isSameOrigin(h({ origin: app }), app)).toBe(true)
  })

  it('rejects other origins, including look-alikes and null', () => {
    expect(isSameOrigin(h({ origin: 'https://evil.example' }), app)).toBe(false)
    expect(isSameOrigin(h({ origin: 'https://agenticlibrary.app.evil.example' }), app)).toBe(false)
    expect(isSameOrigin(h({ origin: 'http://agenticlibrary.app' }), app)).toBe(false)
    expect(isSameOrigin(h({ origin: 'null' }), app)).toBe(false)
    expect(isSameOrigin(h({ origin: 'https://evil.example', 'sec-fetch-site': 'same-origin' }), app)).toBe(false)
  })

  it('falls back to Sec-Fetch-Site: same-origin only when there is no Origin', () => {
    expect(isSameOrigin(h({ 'sec-fetch-site': 'same-origin' }), app)).toBe(true)
    expect(isSameOrigin(h({ 'sec-fetch-site': 'same-site' }), app)).toBe(false)
    expect(isSameOrigin(h({ 'sec-fetch-site': 'cross-site' }), app)).toBe(false)
    expect(isSameOrigin(h({}), app)).toBe(false)
  })
})

describe('clientIp', () => {
  it('takes X-Real-IP from nginx, then the socket address', () => {
    expect(clientIp(new Headers({ 'x-real-ip': '203.0.113.7' }), '127.0.0.1')).toBe('203.0.113.7')
    expect(clientIp(new Headers({ 'x-real-ip': '2001:db8::1' }))).toBe('2001:db8::1')
    expect(clientIp(new Headers(), '::ffff:127.0.0.1')).toBe('127.0.0.1')
    expect(clientIp(new Headers({ 'x-real-ip': 'not an ip' }), '::1')).toBe('::1')
    expect(clientIp(new Headers())).toBeNull()
  })
})
