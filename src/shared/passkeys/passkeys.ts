import { isOneOf } from '../lib/json-shape.ts'

export const MAX_PASSKEYS = 10
export const CHALLENGE_TTL_MS = 5 * 60 * 1000
export const NAME_MAX = 60
export const KNOWN_TRANSPORTS = ['usb', 'nfc', 'ble', 'internal', 'hybrid', 'smart-card'] as const
export type Transport = (typeof KNOWN_TRANSPORTS)[number]

export const isTransport = (value: unknown): value is Transport => isOneOf(value, KNOWN_TRANSPORTS)

export const ADD_PASSKEY_ERRORS = [
  'signed_out',
  'invalid',
  'password',
  'quota',
  'expired',
  'refused',
  'taken',
  'failed',
] as const
export type AddPasskeyError = (typeof ADD_PASSKEY_ERRORS)[number]

export const SIGN_IN_ERRORS = ['invalid', 'refused', 'limited', 'unavailable'] as const
export type SignInError = (typeof SIGN_IN_ERRORS)[number]

export interface PasskeyView {
  id: string
  name: string
  createdAt: string
  lastUsedAt: string | null
  backedUp: boolean
}

type Base64Url = string

interface CredentialDescriptorJSON {
  id: Base64Url
  type: 'public-key'
  transports?: string[]
}

export interface CreationOptionsJSON {
  rp: { id?: string; name: string }
  user: { id: Base64Url; name: string; displayName: string }
  challenge: Base64Url
  pubKeyCredParams: { type: 'public-key'; alg: number }[]
  timeout?: number
  excludeCredentials?: CredentialDescriptorJSON[]
  authenticatorSelection?: {
    authenticatorAttachment?: 'platform' | 'cross-platform'
    residentKey?: 'discouraged' | 'preferred' | 'required'
    requireResidentKey?: boolean
    userVerification?: 'discouraged' | 'preferred' | 'required'
  }
  attestation?: 'none' | 'indirect' | 'direct' | 'enterprise'
  hints?: string[]
  extensions?: Record<string, unknown>
}

export interface RequestOptionsJSON {
  challenge: Base64Url
  timeout?: number
  rpId?: string
  allowCredentials?: CredentialDescriptorJSON[]
  userVerification?: 'discouraged' | 'preferred' | 'required'
  hints?: string[]
  extensions?: Record<string, unknown>
}

export interface RegistrationCredentialJSON {
  id: Base64Url
  rawId: Base64Url
  type: 'public-key'
  response: {
    clientDataJSON: Base64Url
    attestationObject: Base64Url
    authenticatorData?: Base64Url
    transports?: Transport[]
    publicKeyAlgorithm?: number
    publicKey?: Base64Url
  }
  authenticatorAttachment?: 'platform' | 'cross-platform'
  clientExtensionResults: Record<string, unknown>
}

export interface AuthenticationCredentialJSON {
  id: Base64Url
  rawId: Base64Url
  type: 'public-key'
  response: {
    clientDataJSON: Base64Url
    authenticatorData: Base64Url
    signature: Base64Url
    userHandle?: Base64Url
  }
  authenticatorAttachment?: 'platform' | 'cross-platform'
  clientExtensionResults: Record<string, unknown>
}
