import { describe, expect, it } from 'vitest'
import { CHALLENGE_TTL_MS, isTransport, KNOWN_TRANSPORTS, MAX_PASSKEYS, NAME_MAX } from '~/shared/passkeys/passkeys'

describe('the passkeys contract', () => {
  it('has the limits the plan decided', () => {
    expect(MAX_PASSKEYS).toBe(10)
    expect(CHALLENGE_TTL_MS).toBe(300_000)
    expect(NAME_MAX).toBe(60)
  })

  it('knows WebAuthn’s transports and nothing else', () => {
    expect(KNOWN_TRANSPORTS).toEqual(['usb', 'nfc', 'ble', 'internal', 'hybrid', 'smart-card'])
    for (const transport of KNOWN_TRANSPORTS) expect(isTransport(transport)).toBe(true)
    for (const other of ['cable', 'USB', '', 1, null, undefined]) expect(isTransport(other)).toBe(false)
  })
})
