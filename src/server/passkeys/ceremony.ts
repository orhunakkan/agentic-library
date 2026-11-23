import '@tanstack/react-start/server-only'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import {
  type AuthenticationCredentialJSON,
  CHALLENGE_TTL_MS,
  type CreationOptionsJSON,
  isTransport,
  type RegistrationCredentialJSON,
  type RequestOptionsJSON,
  type Transport,
} from '../../shared/passkeys/passkeys.ts'
import type { RelyingParty } from './relying-party.ts'

export const ALGORITHMS = [-8, -7, -257]

const bytes = (buffer: Uint8Array) => new Uint8Array(buffer)

export type Refusal = { ok: false; reason: string }

export function refusalReason(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (/counter/i.test(message)) return 'counter'
  if (/user verif/i.test(message)) return 'user verification'
  if (/origin/i.test(message)) return 'origin'
  if (/rp ?id/i.test(message)) return 'rp id'
  if (/challenge/i.test(message)) return 'challenge'
  if (/signature/i.test(message)) return 'signature'
  if (/algorithm/i.test(message)) return 'algorithm'
  return 'invalid'
}

export async function registrationOptions(input: {
  rp: RelyingParty
  userHandle: Uint8Array
  username: string
  challenge: Uint8Array
  exclude: { id: string; transports: Transport[] }[]
}): Promise<CreationOptionsJSON> {
  const options = await generateRegistrationOptions({
    rpName: input.rp.rpName,
    rpID: input.rp.rpID,
    userID: bytes(input.userHandle),
    userName: input.username,
    userDisplayName: input.username,
    challenge: bytes(input.challenge),
    timeout: CHALLENGE_TTL_MS,
    attestationType: 'none',
    excludeCredentials: input.exclude,
    authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
    supportedAlgorithmIDs: ALGORITHMS,
  })
  return options as CreationOptionsJSON
}

export type VerifiedRegistration = {
  ok: true
  credentialId: Buffer
  publicKey: Buffer
  signCount: number
  backedUp: boolean
  transports: Transport[]
}

export async function verifyRegistration(input: {
  rp: RelyingParty
  credential: RegistrationCredentialJSON
  challenge: string
}): Promise<VerifiedRegistration | Refusal> {
  try {
    const result = await verifyRegistrationResponse({
      response: input.credential,
      expectedChallenge: input.challenge,
      expectedOrigin: input.rp.origin,
      expectedRPID: input.rp.rpID,
      requireUserVerification: true,
      supportedAlgorithmIDs: ALGORITHMS,
    })
    if (!result.verified) return { ok: false, reason: 'invalid' }
    const { credential, credentialBackedUp } = result.registrationInfo
    return {
      ok: true,
      credentialId: Buffer.from(credential.id, 'base64url'),
      publicKey: Buffer.from(credential.publicKey),
      signCount: credential.counter,
      backedUp: credentialBackedUp,
      transports: (input.credential.response.transports ?? []).filter(isTransport),
    }
  } catch (error) {
    return { ok: false, reason: refusalReason(error) }
  }
}

export async function signInOptions(input: { rp: RelyingParty; challenge: Uint8Array }): Promise<RequestOptionsJSON> {
  const options = await generateAuthenticationOptions({
    rpID: input.rp.rpID,
    challenge: bytes(input.challenge),
    timeout: CHALLENGE_TTL_MS,
    userVerification: 'required',
  })
  return options as RequestOptionsJSON
}

export interface StoredCredential {
  credentialId: Buffer
  publicKey: Buffer
  signCount: number
  transports: Transport[]
}

export async function verifyAuthentication(input: {
  rp: RelyingParty
  credential: AuthenticationCredentialJSON
  challenge: string
  stored: StoredCredential
}): Promise<{ ok: true; signCount: number; backedUp: boolean } | Refusal> {
  try {
    const result = await verifyAuthenticationResponse({
      response: input.credential,
      expectedChallenge: input.challenge,
      expectedOrigin: input.rp.origin,
      expectedRPID: input.rp.rpID,
      requireUserVerification: true,
      credential: {
        id: input.stored.credentialId.toString('base64url'),
        publicKey: bytes(input.stored.publicKey),
        counter: input.stored.signCount,
        transports: input.stored.transports,
      },
    })
    if (!result.verified) return { ok: false, reason: 'signature' }
    return {
      ok: true,
      signCount: result.authenticationInfo.newCounter,
      backedUp: result.authenticationInfo.credentialBackedUp,
    }
  } catch (error) {
    return { ok: false, reason: refusalReason(error) }
  }
}
