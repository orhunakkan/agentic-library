import { describe, expect, it } from 'vitest'
import {
  authenticationJSON,
  creationOptions,
  fromBase64url,
  registrationJSON,
  requestOptions,
  toBase64url,
} from '~/client/features/passkeys/passkey-json'
import type { CreationOptionsJSON, RequestOptionsJSON } from '~/shared/passkeys/passkeys'

const bytes = (...values: number[]) => new Uint8Array(values).buffer
const asBytes = (buffer: BufferSource) => [...new Uint8Array(buffer as ArrayBuffer)]

const CREATION: CreationOptionsJSON = {
  rp: { name: 'Folio', id: 'agenticlibrary.app' },
  user: { id: 'AQID', name: 'ann', displayName: 'ann' },
  challenge: '-_8',
  pubKeyCredParams: [
    { type: 'public-key', alg: -8 },
    { type: 'public-key', alg: -7 },
    { type: 'public-key', alg: -257 },
  ],
  timeout: 300000,
  attestation: 'none',
  excludeCredentials: [{ id: 'BAUG', type: 'public-key', transports: ['internal'] }],
  authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
  extensions: { credProps: true },
}

const REQUEST: RequestOptionsJSON = {
  challenge: 'AAEC',
  timeout: 300000,
  rpId: 'agenticlibrary.app',
  userVerification: 'required',
}

describe('base64url', () => {
  it('round-trips bytes without padding, with - and _', () => {
    expect(toBase64url(bytes(0xfb, 0xff))).toBe('-_8')
    expect(asBytes(fromBase64url('-_8'))).toEqual([0xfb, 0xff])
    expect(toBase64url(new Uint8Array([1, 2, 3, 4]))).toBe('AQIDBA')
    expect(asBytes(fromBase64url('AQIDBA'))).toEqual([1, 2, 3, 4])
    expect(toBase64url(new ArrayBuffer(0))).toBe('')
  })

  it('reads a view’s own bytes, not its whole buffer', () => {
    const view = new Uint8Array([9, 1, 2, 9]).subarray(1, 3)
    expect(toBase64url(view)).toBe(toBase64url(bytes(1, 2)))
  })
})

describe('creationOptions', () => {
  it('turns the ids and challenge into bytes and keeps the rest', () => {
    const options = creationOptions(CREATION)
    expect(asBytes(options.user.id)).toEqual([1, 2, 3])
    expect(options.user.name).toBe('ann')
    expect(asBytes(options.challenge)).toEqual([0xfb, 0xff])
    expect(options.excludeCredentials?.map((d) => [d.type, asBytes(d.id), d.transports])).toEqual([
      ['public-key', [4, 5, 6], ['internal']],
    ])
    expect(options).toMatchObject({
      rp: CREATION.rp,
      pubKeyCredParams: CREATION.pubKeyCredParams,
      timeout: 300000,
      attestation: 'none',
      authenticatorSelection: CREATION.authenticatorSelection,
    })
  })

  it('leaves out what the server left out', () => {
    const options = creationOptions({
      rp: { name: 'Folio' },
      user: CREATION.user,
      challenge: 'AA',
      pubKeyCredParams: [],
    })
    expect(Object.keys(options).sort()).toEqual(['challenge', 'excludeCredentials', 'pubKeyCredParams', 'rp', 'user'])
    expect(options.excludeCredentials).toEqual([])
  })
})

describe('requestOptions', () => {
  it('asks for any discoverable passkey of the RP', () => {
    const options = requestOptions(REQUEST)
    expect(asBytes(options.challenge)).toEqual([0, 1, 2])
    expect(options).toMatchObject({ rpId: 'agenticlibrary.app', timeout: 300000, userVerification: 'required' })
    expect(options.allowCredentials).toEqual([])
    expect(Object.keys(requestOptions({ challenge: 'AA' })).sort()).toEqual(['allowCredentials', 'challenge'])
  })

  it('keeps an allow list’s ids as bytes', () => {
    const options = requestOptions({ ...REQUEST, allowCredentials: [{ id: 'BAUG', type: 'public-key' }] })
    expect(options.allowCredentials?.map((d) => asBytes(d.id))).toEqual([[4, 5, 6]])
  })
})

describe('registrationJSON', () => {
  const credential = {
    id: 'AQID',
    rawId: bytes(1, 2, 3),
    type: 'public-key',
    authenticatorAttachment: 'platform',
    response: {
      clientDataJSON: bytes(7),
      attestationObject: new Uint8Array([8, 9]),
      getTransports: () => ['internal', 'hybrid', 'internal', 'cable'],
      getAuthenticatorData: () => bytes(10),
      getPublicKey: () => bytes(11),
      getPublicKeyAlgorithm: () => -7,
    },
  }

  it('is the standard JSON, with known transports once each and no extension outputs', () => {
    expect(registrationJSON(credential)).toEqual({
      id: 'AQID',
      rawId: 'AQID',
      type: 'public-key',
      response: {
        clientDataJSON: 'Bw',
        attestationObject: 'CAk',
        authenticatorData: 'Cg',
        transports: ['internal', 'hybrid'],
        publicKey: 'Cw',
        publicKeyAlgorithm: -7,
      },
      authenticatorAttachment: 'platform',
      clientExtensionResults: {},
    })
  })

  it('works for a browser without the newer methods, or with no attachment', () => {
    const bare = {
      id: 'AQID',
      rawId: bytes(1, 2, 3),
      authenticatorAttachment: null,
      response: { clientDataJSON: bytes(7), attestationObject: bytes(8), getPublicKey: () => null },
    }
    expect(registrationJSON(bare)).toEqual({
      id: 'AQID',
      rawId: 'AQID',
      type: 'public-key',
      response: { clientDataJSON: 'Bw', attestationObject: 'CA', transports: [] },
      clientExtensionResults: {},
    })
  })
})

describe('authenticationJSON', () => {
  const credential = (userHandle: ArrayBuffer | null) => ({
    id: 'AQID',
    rawId: bytes(1, 2, 3),
    authenticatorAttachment: 'cross-platform',
    response: { clientDataJSON: bytes(7), authenticatorData: bytes(10), signature: bytes(12), userHandle },
  })

  it('is the standard JSON, with the user handle', () => {
    expect(authenticationJSON(credential(bytes(13)))).toEqual({
      id: 'AQID',
      rawId: 'AQID',
      type: 'public-key',
      response: { clientDataJSON: 'Bw', authenticatorData: 'Cg', signature: 'DA', userHandle: 'DQ' },
      authenticatorAttachment: 'cross-platform',
      clientExtensionResults: {},
    })
  })

  it('leaves out a missing or empty user handle', () => {
    expect(authenticationJSON(credential(null)).response).not.toHaveProperty('userHandle')
    expect(authenticationJSON(credential(new ArrayBuffer(0))).response).not.toHaveProperty('userHandle')
  })
})
