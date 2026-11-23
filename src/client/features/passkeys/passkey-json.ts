import {
  type AuthenticationCredentialJSON,
  type CreationOptionsJSON,
  isTransport,
  type RegistrationCredentialJSON,
  type RequestOptionsJSON,
} from '~/shared/passkeys/passkeys'

type Bytes = ArrayBuffer | ArrayBufferView

export function fromBase64url(value: string): ArrayBuffer {
  const base64 = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

export function toBase64url(value: Bytes): string {
  const bytes =
    value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const descriptors = (list: CreationOptionsJSON['excludeCredentials']): PublicKeyCredentialDescriptor[] =>
  (list ?? []).map((d) => ({
    type: 'public-key',
    id: fromBase64url(d.id),
    ...(d.transports ? { transports: d.transports as AuthenticatorTransport[] } : {}),
  }))

export function creationOptions(json: CreationOptionsJSON): PublicKeyCredentialCreationOptions {
  return {
    rp: json.rp,
    user: { ...json.user, id: fromBase64url(json.user.id) },
    challenge: fromBase64url(json.challenge),
    pubKeyCredParams: json.pubKeyCredParams,
    ...(json.timeout !== undefined ? { timeout: json.timeout } : {}),
    excludeCredentials: descriptors(json.excludeCredentials),
    ...(json.authenticatorSelection ? { authenticatorSelection: json.authenticatorSelection } : {}),
    ...(json.attestation ? { attestation: json.attestation } : {}),
  }
}

export function requestOptions(json: RequestOptionsJSON): PublicKeyCredentialRequestOptions {
  return {
    challenge: fromBase64url(json.challenge),
    ...(json.rpId ? { rpId: json.rpId } : {}),
    ...(json.timeout !== undefined ? { timeout: json.timeout } : {}),
    ...(json.userVerification ? { userVerification: json.userVerification } : {}),
    allowCredentials: descriptors(json.allowCredentials),
  }
}

interface CredentialLike {
  id: string
  rawId: Bytes
  authenticatorAttachment?: string | null
}

interface AttestationLike {
  clientDataJSON: Bytes
  attestationObject: Bytes
  getTransports?: () => string[]
  getAuthenticatorData?: () => Bytes
  getPublicKey?: () => Bytes | null
  getPublicKeyAlgorithm?: () => number
}

interface AssertionLike {
  clientDataJSON: Bytes
  authenticatorData: Bytes
  signature: Bytes
  userHandle?: Bytes | null
}

const attachment = (credential: CredentialLike): { authenticatorAttachment?: 'platform' | 'cross-platform' } => {
  const value = credential.authenticatorAttachment
  return value === 'platform' || value === 'cross-platform' ? { authenticatorAttachment: value } : {}
}

export function registrationJSON(
  credential: CredentialLike & { response: AttestationLike },
): RegistrationCredentialJSON {
  const { response } = credential
  const publicKey = response.getPublicKey?.()
  const algorithm = response.getPublicKeyAlgorithm?.()
  const authenticatorData = response.getAuthenticatorData?.()
  return {
    id: credential.id,
    rawId: toBase64url(credential.rawId),
    type: 'public-key',
    response: {
      clientDataJSON: toBase64url(response.clientDataJSON),
      attestationObject: toBase64url(response.attestationObject),
      ...(authenticatorData ? { authenticatorData: toBase64url(authenticatorData) } : {}),
      transports: [...new Set(response.getTransports?.() ?? [])].filter(isTransport),
      ...(publicKey ? { publicKey: toBase64url(publicKey) } : {}),
      ...(typeof algorithm === 'number' ? { publicKeyAlgorithm: algorithm } : {}),
    },
    ...attachment(credential),
    clientExtensionResults: {},
  }
}

export function authenticationJSON(
  credential: CredentialLike & { response: AssertionLike },
): AuthenticationCredentialJSON {
  const { response } = credential
  const handle = response.userHandle
  return {
    id: credential.id,
    rawId: toBase64url(credential.rawId),
    type: 'public-key',
    response: {
      clientDataJSON: toBase64url(response.clientDataJSON),
      authenticatorData: toBase64url(response.authenticatorData),
      signature: toBase64url(response.signature),
      ...(handle && handle.byteLength > 0 ? { userHandle: toBase64url(handle) } : {}),
    },
    ...attachment(credential),
    clientExtensionResults: {},
  }
}
