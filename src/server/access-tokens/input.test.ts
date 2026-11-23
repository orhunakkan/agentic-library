import { describe, expect, it } from 'vitest'
import { privateHeaders } from '../private-pages'
import { redact } from '../redact'
import { hashToken, isWellFormedAccessToken, newAccessToken, newSessionToken } from '../security'
import { isTokenId, parseAuthorization, parseTokenCreate, parseTokenRevoke } from './input'

const TOKEN = `folio_at_${'a'.repeat(43)}`

describe('access tokens', () => {
  it('are folio_at_ and 43 base64url characters, a new one each time', () => {
    const one = newAccessToken()
    expect(one).toMatch(/^folio_at_[A-Za-z0-9_-]{43}$/)
    expect(one).toHaveLength(52)
    expect(newAccessToken()).not.toBe(one)
    expect(hashToken(one)).toHaveLength(32)
  })

  it('are well-formed only in exactly that shape', () => {
    expect(isWellFormedAccessToken(newAccessToken())).toBe(true)
    expect(isWellFormedAccessToken(TOKEN)).toBe(true)
    for (const bad of [
      newSessionToken(),
      `sk-ant-${'a'.repeat(43)}`,
      `folio_xx_${'a'.repeat(43)}`,
      `folio_at_${'a'.repeat(42)}`,
      `folio_at_${'a'.repeat(44)}`,
      `folio_at_${'a'.repeat(42)}=`,
      ` ${TOKEN}`,
      '',
      null,
      undefined,
    ])
      expect(isWellFormedAccessToken(bad)).toBe(false)
  })
})

describe('parseAuthorization', () => {
  it('is none without the header', () => {
    expect(parseAuthorization(null)).toEqual({ kind: 'none' })
  })

  it('takes a well-formed token after Bearer in any case, with one space', () => {
    for (const scheme of ['Bearer', 'bearer', 'BEARER', 'bEaReR'])
      expect(parseAuthorization(`${scheme} ${TOKEN}`)).toEqual({ kind: 'bearer', token: TOKEN })
  })

  it('refuses a Bearer header without a usable token, saying it was a bearer one', () => {
    for (const value of [
      'Bearer',
      'Bearer ',
      `Bearer  ${TOKEN}`,
      `Bearer ${TOKEN} `,
      `Bearer\t${TOKEN}`,
      `Bearer ${newSessionToken()}`,
      `Bearer sk-ant-${'a'.repeat(40)}`,
      `Bearer ${TOKEN}, Bearer ${TOKEN}`,
    ])
      expect(parseAuthorization(value), value).toEqual({ kind: 'invalid', bearer: true })
  })

  it('refuses another scheme, or no scheme, as not a bearer one', () => {
    for (const value of ['Basic dXNlcjpwYXNz', TOKEN, '', 'Bearertoken', `Token ${TOKEN}`])
      expect(parseAuthorization(value), value).toEqual({ kind: 'invalid', bearer: false })
  })
})

describe('parseTokenCreate', () => {
  const base = { username: 'ann', password: 'a long enough password' }

  it('defaults the name and the lifetime', () => {
    expect(parseTokenCreate(base)).toEqual({ ...base, name: 'Access token', days: 30 })
  })

  it('trims the name and keeps it to 1–60 characters without control characters', () => {
    expect(parseTokenCreate({ ...base, name: '  API tests  ' })?.name).toBe('API tests')
    expect(parseTokenCreate({ ...base, name: 'x' })?.name).toBe('x')
    expect(parseTokenCreate({ ...base, name: 'x'.repeat(60) })?.name).toBe('x'.repeat(60))
    for (const name of ['', '   ', 'x'.repeat(61), 'a\nb', 'a\u0000b', 'a\u0085b', 7, null])
      expect(parseTokenCreate({ ...base, name }), String(name)).toBeNull()
  })

  it('takes a whole number of days from 1 to 30', () => {
    expect(parseTokenCreate({ ...base, expiresInDays: 1 })?.days).toBe(1)
    expect(parseTokenCreate({ ...base, expiresInDays: 30 })?.days).toBe(30)
    for (const expiresInDays of [0, 31, 1.5, -1, '7', null, Number.NaN])
      expect(parseTokenCreate({ ...base, expiresInDays }), String(expiresInDays)).toBeNull()
  })

  it('refuses unknown fields, missing or non-string credentials, and an overlong password', () => {
    expect(parseTokenCreate({ ...base, scope: 'all' })).toBeNull()
    expect(parseTokenCreate({ username: 'ann' })).toBeNull()
    expect(parseTokenCreate({ password: 'x' })).toBeNull()
    expect(parseTokenCreate({ username: 1, password: 'x' })).toBeNull()
    expect(parseTokenCreate({ username: 'ann', password: ['x'] })).toBeNull()
    expect(parseTokenCreate({ username: 'a'.repeat(65), password: 'x' })).toBeNull()
    expect(parseTokenCreate({ username: 'ann', password: 'x'.repeat(1025) })).toBeNull()
    expect(parseTokenCreate({ username: 'ann', password: 'x'.repeat(1024) })).not.toBeNull()
    for (const body of [null, [], 'ann', 1]) expect(parseTokenCreate(body)).toBeNull()
  })
})

describe('parseTokenRevoke and isTokenId', () => {
  it('takes exactly { intent: "revoke" }', () => {
    expect(parseTokenRevoke({ intent: 'revoke' })).toBe(true)
    for (const body of [{}, { intent: 'delete' }, { intent: 'revoke', id: 'x' }, null, [], 'revoke'])
      expect(parseTokenRevoke(body)).toBe(false)
  })

  it('takes a lowercase UUID only', () => {
    expect(isTokenId('0b6d5c3e-9f1a-4c2b-8d7e-6a5b4c3d2e1f')).toBe(true)
    for (const id of [
      'current',
      '0B6D5C3E-9F1A-4C2B-8D7E-6A5B4C3D2E1F',
      '1',
      '',
      '0b6d5c3e-9f1a-4c2b-8d7e-6a5b4c3d2e1',
    ])
      expect(isTokenId(id)).toBe(false)
  })
})

describe('a token in a log line, and the API’s caching', () => {
  it('is masked wherever it appears', () => {
    const token = newAccessToken()
    expect(redact(`failed with ${token} in it`)).toBe('failed with folio_at_[redacted] in it')
    expect(redact(JSON.stringify({ token }))).toBe('{"token":"folio_at_[redacted]"}')
    expect(redact(`authorization: Bearer ${token}`)).not.toContain(token.slice(9))
  })

  it('makes every /api answer private and unstored', () => {
    expect(privateHeaders('/api/me', null)).toEqual({ 'cache-control': 'private, no-store' })
    expect(privateHeaders('/api/tokens/current', null)).toEqual({ 'cache-control': 'private, no-store' })
    expect(privateHeaders('/apis', null)).toBeNull()
  })
})
