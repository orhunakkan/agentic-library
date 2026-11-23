import { createHash, createSign, generateKeyPairSync, type KeyObject, randomBytes } from 'node:crypto'
import { isoCBOR } from '@simplewebauthn/server/helpers'
import type {
  AuthenticationCredentialJSON,
  CreationOptionsJSON,
  RegistrationCredentialJSON,
  RequestOptionsJSON,
} from '../../shared/passkeys/passkeys.ts'

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url')
const sha256 = (data: Uint8Array | string) => createHash('sha256').update(data).digest()

const FLAG = { up: 0x01, uv: 0x04, be: 0x08, bs: 0x10, at: 0x40 }

export interface SoftPasskey {
  id: Buffer
  rpId: string
  userHandle: string
  privateKey: KeyObject
  publicKey: KeyObject
  signCount: number
}

function coseKey(publicKey: KeyObject): Uint8Array {
  const jwk = publicKey.export({ format: 'jwk' })
  return isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x ?? '', 'base64url')],
      [-3, Buffer.from(jwk.y ?? '', 'base64url')],
    ]),
  )
}

function authData(rpId: string, flags: number, signCount: number, attested?: Buffer): Buffer {
  const count = Buffer.alloc(4)
  count.writeUInt32BE(signCount)
  return Buffer.concat([sha256(rpId), Buffer.from([flags]), count, ...(attested ? [attested] : [])])
}

function clientData(type: 'webauthn.create' | 'webauthn.get', challenge: string, origin: string): Buffer {
  return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }))
}

export interface CeremonyOptions {
  origin: string
  rpId?: string
  verified?: boolean
  backedUp?: boolean
  challenge?: string
}

export class SoftAuthenticator {
  readonly passkeys: SoftPasskey[] = []

  register(options: CreationOptionsJSON, ceremony: CeremonyOptions): RegistrationCredentialJSON {
    const rpId = options.rp.id ?? new URL(ceremony.origin).hostname
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const id = randomBytes(16)
    const passkey: SoftPasskey = { id, rpId, userHandle: options.user.id, privateKey, publicKey, signCount: 0 }
    this.passkeys.push(passkey)
    const length = Buffer.alloc(2)
    length.writeUInt16BE(id.length)
    const attested = Buffer.concat([Buffer.alloc(16), length, id, coseKey(publicKey)])
    const data = authData(ceremony.rpId ?? rpId, flagsFor(ceremony) | FLAG.at, 0, attested)
    const attestation = isoCBOR.encode(
      new Map<string, unknown>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', data],
      ]) as never,
    )
    return {
      id: b64(id),
      rawId: b64(id),
      type: 'public-key',
      response: {
        clientDataJSON: b64(clientData('webauthn.create', ceremony.challenge ?? options.challenge, ceremony.origin)),
        attestationObject: b64(attestation),
        transports: ['internal'],
      },
      authenticatorAttachment: 'platform',
      clientExtensionResults: {},
    }
  }

  assert(
    options: RequestOptionsJSON,
    ceremony: CeremonyOptions & {
      passkey?: SoftPasskey
      signCount?: number
      signWith?: KeyObject
      userHandle?: string | null
    },
  ): AuthenticationCredentialJSON {
    const passkey = ceremony.passkey ?? this.passkeys.at(-1)
    if (!passkey) throw new Error('no passkey to sign with')
    const signCount = ceremony.signCount ?? passkey.signCount + 1
    passkey.signCount = signCount
    const data = authData(ceremony.rpId ?? options.rpId ?? passkey.rpId, flagsFor(ceremony), signCount)
    const client = clientData('webauthn.get', ceremony.challenge ?? options.challenge, ceremony.origin)
    const signature = createSign('sha256')
      .update(Buffer.concat([data, sha256(client)]))
      .sign(ceremony.signWith ?? passkey.privateKey)
    const userHandle = ceremony.userHandle === undefined ? passkey.userHandle : ceremony.userHandle
    return {
      id: b64(passkey.id),
      rawId: b64(passkey.id),
      type: 'public-key',
      response: {
        clientDataJSON: b64(client),
        authenticatorData: b64(data),
        signature: b64(signature),
        ...(userHandle === null ? {} : { userHandle }),
      },
      authenticatorAttachment: 'platform',
      clientExtensionResults: {},
    }
  }
}

function flagsFor(ceremony: CeremonyOptions): number {
  return FLAG.up | (ceremony.verified === false ? 0 : FLAG.uv) | (ceremony.backedUp ? FLAG.be | FLAG.bs : 0)
}

export function strayKey(): KeyObject {
  return generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey
}
