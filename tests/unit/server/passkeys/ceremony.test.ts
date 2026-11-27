import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  ALGORITHMS,
  refusalReason,
  registrationOptions,
  signInOptions,
  verifyAuthentication,
  verifyRegistration,
} from '~/server/passkeys/ceremony'
import { rpFor } from '~/server/passkeys/relying-party'
import { SoftAuthenticator, strayKey } from '../../../support/server/authenticator'

const rp = rpFor('http://localhost:3100')
const origin = rp.origin

async function newOptions(exclude: { id: string; transports: [] }[] = []) {
  return registrationOptions({ rp, userHandle: randomBytes(32), username: 'ann', challenge: randomBytes(32), exclude })
}

async function registered(authenticator = new SoftAuthenticator(), backedUp = false) {
  const options = await newOptions()
  const credential = authenticator.register(options, { origin, backedUp })
  const verified = await verifyRegistration({ rp, credential, challenge: options.challenge })
  if (!verified.ok) throw new Error(verified.reason)
  return { authenticator, verified, options }
}

const stored = (verified: Awaited<ReturnType<typeof registered>>['verified'], signCount = verified.signCount) => ({
  credentialId: verified.credentialId,
  publicKey: verified.publicKey,
  signCount,
  transports: verified.transports,
})

describe('registration options', () => {
  it('ask for a discoverable, user-verified passkey with no attestation', async () => {
    const exclude = [{ id: 'AAAA', transports: [] as [] }]
    const options = await newOptions(exclude)
    expect(options.rp).toEqual({ name: 'Folio', id: 'localhost' })
    expect(options.user.name).toBe('ann')
    expect(options.user.displayName).toBe('ann')
    expect(Buffer.from(options.user.id, 'base64url')).toHaveLength(32)
    expect(Buffer.from(options.challenge, 'base64url')).toHaveLength(32)
    expect(options.pubKeyCredParams.map((p) => p.alg)).toEqual(ALGORITHMS)
    expect(options.attestation).toBe('none')
    expect(options.timeout).toBe(300_000)
    expect(options.authenticatorSelection).toMatchObject({ residentKey: 'required', userVerification: 'required' })
    expect(options.excludeCredentials).toEqual([{ id: 'AAAA', type: 'public-key', transports: [] }])
  })
})

describe('a passkey', () => {
  it('registers and then signs in', async () => {
    const { authenticator, verified } = await registered()
    expect(verified.transports).toEqual(['internal'])
    expect(verified.backedUp).toBe(false)
    const options = await signInOptions({ rp, challenge: randomBytes(32) })
    expect(options).toMatchObject({ rpId: 'localhost', userVerification: 'required', timeout: 300_000 })
    expect(options.allowCredentials ?? []).toEqual([])
    const credential = authenticator.assert(options, { origin })
    expect(
      await verifyAuthentication({ rp, credential, challenge: options.challenge, stored: stored(verified) }),
    ).toEqual({ ok: true, signCount: 1, backedUp: false })
  })

  it('reports a synced passkey as backed up', async () => {
    const { verified } = await registered(new SoftAuthenticator(), true)
    expect(verified.backedUp).toBe(true)
  })
})

describe('registration refuses', () => {
  const refused = async (
    change: (o: Awaited<ReturnType<typeof newOptions>>) => Parameters<SoftAuthenticator['register']>[1],
    challenge?: string,
  ) => {
    const options = await newOptions()
    const credential = new SoftAuthenticator().register(options, change(options))
    return verifyRegistration({ rp, credential, challenge: challenge ?? options.challenge })
  }

  it('another origin', async () => {
    expect(await refused(() => ({ origin: 'https://evil.example' }))).toEqual({ ok: false, reason: 'origin' })
  })
  it('another RP ID', async () => {
    expect(await refused(() => ({ origin, rpId: 'evil.example' }))).toEqual({ ok: false, reason: 'rp id' })
  })
  it('a passkey that didn’t verify the user', async () => {
    expect(await refused(() => ({ origin, verified: false }))).toEqual({ ok: false, reason: 'user verification' })
  })
  it('another challenge', async () => {
    expect(await refused(() => ({ origin }), Buffer.alloc(32).toString('base64url'))).toEqual({
      ok: false,
      reason: 'challenge',
    })
  })
})

describe('signing in refuses', () => {
  it('a bad signature, another origin, RP ID or challenge, and UV not set', async () => {
    const { authenticator, verified } = await registered()
    const options = await signInOptions({ rp, challenge: randomBytes(32) })
    const check = (ceremony: Parameters<SoftAuthenticator['assert']>[1], challenge = options.challenge) =>
      verifyAuthentication({
        rp,
        credential: authenticator.assert(options, ceremony),
        challenge,
        stored: stored(verified),
      })
    expect(await check({ origin, signWith: strayKey() })).toEqual({ ok: false, reason: 'signature' })
    expect(await check({ origin: 'https://evil.example' })).toEqual({ ok: false, reason: 'origin' })
    expect(await check({ origin, rpId: 'evil.example' })).toEqual({ ok: false, reason: 'rp id' })
    expect(await check({ origin, verified: false })).toEqual({ ok: false, reason: 'user verification' })
    expect(await check({ origin }, Buffer.alloc(32).toString('base64url'))).toEqual({ ok: false, reason: 'challenge' })
  })

  it('a counter that didn’t go up, and accepts a synced passkey’s 0', async () => {
    const { authenticator, verified } = await registered()
    const options = await signInOptions({ rp, challenge: randomBytes(32) })
    const check = (sent: number, known: number) =>
      verifyAuthentication({
        rp,
        credential: authenticator.assert(options, { origin, signCount: sent }),
        challenge: options.challenge,
        stored: stored(verified, known),
      })
    expect(await check(5, 5)).toEqual({ ok: false, reason: 'counter' })
    expect(await check(4, 5)).toEqual({ ok: false, reason: 'counter' })
    expect(await check(6, 5)).toMatchObject({ ok: true, signCount: 6 })
    expect(await check(0, 0)).toMatchObject({ ok: true, signCount: 0 })
  })
})

describe('refusalReason', () => {
  it('falls back to invalid for anything it doesn’t recognise', () => {
    expect(refusalReason(new Error('Unexpected thing'))).toBe('invalid')
    expect(refusalReason('not an error')).toBe('invalid')
    expect(refusalReason(new Error('Unsupported public key algorithm'))).toBe('algorithm')
  })
})
