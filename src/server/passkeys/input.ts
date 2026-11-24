import { isObject, only } from '../../shared/lib/json-shape.ts'
import {
  type AuthenticationCredentialJSON,
  isTransport,
  type RegistrationCredentialJSON,
  type Transport,
} from '../../shared/passkeys/passkeys.ts'
import { isUuid } from '../../shared/uuid.ts'

const LIMITS = {
  credentialId: 1023,
  clientDataJSON: 4 * 1024,
  attestationObject: 12 * 1024,
  registrationAuthData: 12 * 1024,
  assertionAuthData: 4 * 1024,
  signature: 1024,
  userHandle: 64,
  publicKey: 4 * 1024,
}

const PASSWORD_MAX = 1024
const NEXT_MAX = 2048

const BASE64URL = /^[A-Za-z0-9_-]+$/

export function base64urlBytes(value: unknown, max: number): Buffer | null {
  if (typeof value !== 'string' || !BASE64URL.test(value) || value.length % 4 === 1) return null
  if (Math.floor((value.length * 3) / 4) > max) return null
  const bytes = Buffer.from(value, 'base64url')
  return bytes.length >= 1 && bytes.length <= max ? bytes : null
}

const isB64 = (value: unknown, max: number): value is string => base64urlBytes(value, max) !== null
const optionalB64 = (value: unknown, max: number) => value === undefined || isB64(value, max)

const ATTACHMENTS = ['platform', 'cross-platform']
const EXTENSIONS = ['credProps', 'prf', 'largeBlob', 'hmacCreateSecret', 'appid', 'appidExclude']

function isCredentialShell(value: Record<string, unknown>): boolean {
  return (
    only(value, ['id', 'rawId', 'type', 'response', 'authenticatorAttachment', 'clientExtensionResults']) &&
    value.type === 'public-key' &&
    isB64(value.id, LIMITS.credentialId) &&
    value.rawId === value.id &&
    isObject(value.response) &&
    (value.authenticatorAttachment === undefined || ATTACHMENTS.includes(value.authenticatorAttachment as string)) &&
    isObject(value.clientExtensionResults) &&
    only(value.clientExtensionResults, EXTENSIONS)
  )
}

function isTransports(value: unknown): value is Transport[] {
  return Array.isArray(value) && value.length <= 8 && value.every(isTransport)
}

export function parseRegistrationCredential(value: unknown): RegistrationCredentialJSON | null {
  if (!isObject(value) || !isCredentialShell(value)) return null
  const response = value.response as Record<string, unknown>
  if (
    !only(response, [
      'clientDataJSON',
      'attestationObject',
      'authenticatorData',
      'transports',
      'publicKeyAlgorithm',
      'publicKey',
    ]) ||
    !isB64(response.clientDataJSON, LIMITS.clientDataJSON) ||
    !isB64(response.attestationObject, LIMITS.attestationObject) ||
    !optionalB64(response.authenticatorData, LIMITS.registrationAuthData) ||
    !optionalB64(response.publicKey, LIMITS.publicKey) ||
    (response.transports !== undefined && !isTransports(response.transports)) ||
    (response.publicKeyAlgorithm !== undefined && !Number.isInteger(response.publicKeyAlgorithm))
  )
    return null
  return value as unknown as RegistrationCredentialJSON
}

export function parseAuthenticationCredential(value: unknown): AuthenticationCredentialJSON | null {
  if (!isObject(value) || !isCredentialShell(value)) return null
  const response = value.response as Record<string, unknown>
  if (
    !only(response, ['clientDataJSON', 'authenticatorData', 'signature', 'userHandle']) ||
    !isB64(response.clientDataJSON, LIMITS.clientDataJSON) ||
    !isB64(response.authenticatorData, LIMITS.assertionAuthData) ||
    !isB64(response.signature, LIMITS.signature) ||
    !optionalB64(response.userHandle, LIMITS.userHandle)
  )
    return null
  return value as unknown as AuthenticationCredentialJSON
}

export function challengeOf(credential: { response: { clientDataJSON: string } }): Buffer | null {
  try {
    const data: unknown = JSON.parse(Buffer.from(credential.response.clientDataJSON, 'base64url').toString('utf8'))
    return isObject(data) ? base64urlBytes(data.challenge, 64) : null
  } catch {
    return null
  }
}

export function parseAddOptions(value: unknown): { password: string } | null {
  if (!isObject(value) || !only(value, ['password'])) return null
  const { password } = value
  return typeof password === 'string' && password.length <= PASSWORD_MAX ? { password } : null
}

export function parseNewPasskey(value: unknown): { credential: RegistrationCredentialJSON } | null {
  if (!isObject(value) || !only(value, ['credential'])) return null
  const credential = parseRegistrationCredential(value.credential)
  return credential && { credential }
}

export function parseSignIn(value: unknown): { credential: AuthenticationCredentialJSON; next: string | null } | null {
  if (!isObject(value) || !only(value, ['credential', 'next'])) return null
  const credential = parseAuthenticationCredential(value.credential)
  return credential && { credential, next: parseNext(value.next) }
}

export function parseNext(value: unknown): string | null {
  return typeof value === 'string' && value.length <= NEXT_MAX ? value : null
}

export function parsePasskeyId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const id = value.toLowerCase()
  return isUuid(id) ? id : null
}
