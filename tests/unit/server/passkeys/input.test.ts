import { describe, expect, it } from 'vitest'
import {
  base64urlBytes,
  challengeOf,
  parseAddOptions,
  parseAuthenticationCredential,
  parseNewPasskey,
  parseNext,
  parsePasskeyId,
  parseRegistrationCredential,
  parseSignIn,
} from '~/server/passkeys/input'

const b64 = (size: number, fill = 1) => Buffer.alloc(size, fill).toString('base64url')
const clientData = (data: unknown) => Buffer.from(JSON.stringify(data)).toString('base64url')

const registration = (over: Record<string, unknown> = {}, response: Record<string, unknown> = {}) => ({
  id: b64(16),
  rawId: b64(16),
  type: 'public-key',
  response: { clientDataJSON: b64(100), attestationObject: b64(300), transports: ['internal', 'hybrid'], ...response },
  authenticatorAttachment: 'platform',
  clientExtensionResults: {},
  ...over,
})

const assertion = (over: Record<string, unknown> = {}, response: Record<string, unknown> = {}) => ({
  id: b64(16),
  rawId: b64(16),
  type: 'public-key',
  response: {
    clientDataJSON: b64(100),
    authenticatorData: b64(37),
    signature: b64(70),
    userHandle: b64(32),
    ...response,
  },
  clientExtensionResults: {},
  ...over,
})

describe('base64urlBytes', () => {
  it('decodes base64url within a size', () => {
    expect(base64urlBytes(b64(10), 10)).toEqual(Buffer.alloc(10, 1))
    expect(base64urlBytes(b64(11), 10)).toBeNull()
  })
  it('refuses anything that isn’t base64url, and nothing at all', () => {
    for (const bad of ['', 'a+b/', 'abc=', 'a', 'ab cd', 12, null, undefined, ['AA']])
      expect(base64urlBytes(bad, 64)).toBeNull()
  })
})

describe('parseRegistrationCredential', () => {
  it('accepts the standard JSON', () => {
    expect(parseRegistrationCredential(registration())).toEqual(registration())
    const full = registration(
      { clientExtensionResults: { credProps: { rk: true } } },
      { authenticatorData: b64(200), publicKey: b64(91), publicKeyAlgorithm: -7 },
    )
    expect(parseRegistrationCredential(full)).toEqual(full)
    const bare = registration({ authenticatorAttachment: undefined }, { transports: undefined })
    expect(parseRegistrationCredential(bare)).not.toBeNull()
  })

  it('refuses extra keys at every level', () => {
    expect(parseRegistrationCredential(registration({ extra: 1 }))).toBeNull()
    expect(parseRegistrationCredential(registration({}, { extra: 1 }))).toBeNull()
    expect(parseRegistrationCredential(registration({ clientExtensionResults: { made: 'up' } }))).toBeNull()
  })

  it('refuses unknown transports, a wrong type and an id that isn’t rawId', () => {
    expect(parseRegistrationCredential(registration({}, { transports: ['usb', 'cable'] }))).toBeNull()
    expect(parseRegistrationCredential(registration({}, { transports: 'usb' }))).toBeNull()
    expect(parseRegistrationCredential(registration({}, { transports: Array(9).fill('usb') }))).toBeNull()
    expect(parseRegistrationCredential(registration({ type: 'password' }))).toBeNull()
    expect(parseRegistrationCredential(registration({ rawId: b64(16, 2) }))).toBeNull()
    expect(parseRegistrationCredential(registration({ authenticatorAttachment: null }))).toBeNull()
    expect(parseRegistrationCredential(registration({ clientExtensionResults: undefined }))).toBeNull()
    expect(parseRegistrationCredential(registration({}, { publicKeyAlgorithm: '-7' }))).toBeNull()
  })

  it('holds to the sizes', () => {
    expect(parseRegistrationCredential(registration({ id: b64(1023), rawId: b64(1023) }))).not.toBeNull()
    expect(parseRegistrationCredential(registration({ id: b64(1024), rawId: b64(1024) }))).toBeNull()
    expect(parseRegistrationCredential(registration({}, { attestationObject: b64(12 * 1024) }))).not.toBeNull()
    expect(parseRegistrationCredential(registration({}, { attestationObject: b64(12 * 1024 + 1) }))).toBeNull()
    expect(parseRegistrationCredential(registration({}, { clientDataJSON: b64(4097) }))).toBeNull()
    expect(parseRegistrationCredential(registration({}, { attestationObject: 'not base64!' }))).toBeNull()
  })

  it('refuses anything that isn’t an object', () => {
    for (const bad of [null, 'credential', [registration()], 3]) expect(parseRegistrationCredential(bad)).toBeNull()
    expect(parseRegistrationCredential(registration({ response: 'x' }))).toBeNull()
  })
})

describe('parseAuthenticationCredential', () => {
  it('accepts an assertion, with or without a user handle', () => {
    expect(parseAuthenticationCredential(assertion())).toEqual(assertion())
    expect(parseAuthenticationCredential(assertion({}, { userHandle: undefined }))).not.toBeNull()
  })

  it('refuses extra keys, a missing signature, and oversized parts', () => {
    expect(parseAuthenticationCredential(assertion({}, { attestationObject: b64(10) }))).toBeNull()
    expect(parseAuthenticationCredential(assertion({}, { signature: undefined }))).toBeNull()
    expect(parseAuthenticationCredential(assertion({}, { signature: b64(1025) }))).toBeNull()
    expect(parseAuthenticationCredential(assertion({}, { userHandle: b64(65) }))).toBeNull()
    expect(parseAuthenticationCredential(assertion({}, { authenticatorData: b64(4097) }))).toBeNull()
    expect(parseAuthenticationCredential(assertion({ rawId: 'other' }))).toBeNull()
  })
})

describe('challengeOf', () => {
  it('reads the challenge’s bytes from clientDataJSON', () => {
    const challenge = Buffer.alloc(32, 7)
    const data = clientData({ type: 'webauthn.get', challenge: challenge.toString('base64url') })
    expect(challengeOf({ response: { clientDataJSON: data } })).toEqual(challenge)
  })
  it('is null for clientDataJSON that isn’t JSON, or has no usable challenge', () => {
    expect(challengeOf({ response: { clientDataJSON: b64(20) } })).toBeNull()
    expect(challengeOf({ response: { clientDataJSON: clientData([1]) } })).toBeNull()
    expect(challengeOf({ response: { clientDataJSON: clientData({ challenge: 'a+b' }) } })).toBeNull()
  })
})

describe('the bodies', () => {
  it('options take only a password of a sane length', () => {
    expect(parseAddOptions({ password: 'secret' })).toEqual({ password: 'secret' })
    expect(parseAddOptions({ password: 'x'.repeat(1025) })).toBeNull()
    expect(parseAddOptions({ password: 3 })).toBeNull()
    expect(parseAddOptions({ password: 'x', extra: 1 })).toBeNull()
    expect(parseAddOptions('x')).toBeNull()
  })

  it('a new passkey takes only a credential', () => {
    expect(parseNewPasskey({ credential: registration() })).toEqual({ credential: registration() })
    expect(parseNewPasskey({ credential: assertion() })).toBeNull()
    expect(parseNewPasskey({ credential: registration(), next: '/x' })).toBeNull()
    expect(parseNewPasskey(null)).toBeNull()
  })

  it('a sign-in takes a credential and maybe a next path, dropping a strange next', () => {
    expect(parseSignIn({ credential: assertion() })).toEqual({ credential: assertion(), next: null })
    expect(parseSignIn({ credential: assertion(), next: '/account' })).toEqual({
      credential: assertion(),
      next: '/account',
    })
    expect(parseSignIn({ credential: assertion(), next: 5 })).toEqual({ credential: assertion(), next: null })
    expect(parseSignIn({ credential: registration() })).toBeNull()
    expect(parseSignIn({ credential: assertion(), password: 'x' })).toBeNull()
    expect(parseSignIn([])).toBeNull()
  })

  it('next is a short string or nothing', () => {
    expect(parseNext('/library')).toBe('/library')
    expect(parseNext('/'.repeat(2049))).toBeNull()
    expect(parseNext(undefined)).toBeNull()
  })

  it('a passkey id is a UUID, lowercased', () => {
    expect(parsePasskeyId('0B6C0A5E-1D2B-4C3D-8E4F-5A6B7C8D9E0F')).toBe('0b6c0a5e-1d2b-4c3d-8e4f-5a6b7c8d9e0f')
    for (const bad of ['', 'abc', '0b6c0a5e-1d2b-4c3d-8e4f-5a6b7c8d9e0', 1, null])
      expect(parsePasskeyId(bad)).toBeNull()
  })
})
