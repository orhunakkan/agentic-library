import { describe, expect, it } from 'vitest'
import { rpFor } from './relying-party'

describe('rpFor', () => {
  it('scopes passkeys to the exact host of each environment', () => {
    expect(rpFor('https://agenticlibrary.app')).toEqual({
      rpID: 'agenticlibrary.app',
      origin: 'https://agenticlibrary.app',
      rpName: 'Folio',
    })
    expect(rpFor('https://dev.agenticlibrary.app').rpID).toBe('dev.agenticlibrary.app')
  })

  it('keeps the port in the origin but not in the RP ID', () => {
    expect(rpFor('http://localhost:3100')).toEqual({
      rpID: 'localhost',
      origin: 'http://localhost:3100',
      rpName: 'Folio',
    })
    expect(rpFor('http://localhost:3100/').origin).toBe('http://localhost:3100')
  })

  it('refuses an IP address, which WebAuthn can’t use', () => {
    expect(() => rpFor('http://127.0.0.1:3100')).toThrow(/hostname, not an IP address/)
    expect(() => rpFor('http://[::1]:3100')).toThrow(/hostname, not an IP address/)
    expect(() => rpFor('https://203.0.113.7')).toThrow(/hostname, not an IP address/)
  })
})
