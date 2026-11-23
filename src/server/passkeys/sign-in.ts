import '@tanstack/react-start/server-only'
import { safeNext } from '../../shared/lib/safe-next.ts'
import type { SignInError } from '../../shared/passkeys/passkeys.ts'
import { startSession } from '../account-actions.ts'
import { recordEvent, sweepAuditEvents } from '../audit.ts'
import { forbidden, NO_STORE, noStoreJson, requestIp } from '../auth.ts'
import { sweepPaddleEvents } from '../billing/store.ts'
import { getConfig } from '../config.ts'
import { getDb, isDatabaseConfigured } from '../db.ts'
import { PROBLEM_STATUS, readCapped, readJsonBody } from '../json-body.ts'
import { beginAttempt, discardAttempt, ipBlockedUntil, markSucceeded, sweepAttempts } from '../login-attempts.ts'
import { overLimit, PASSKEY_CHALLENGE_LIMIT } from '../rate-limit.ts'
import { logError } from '../redact.ts'
import { isSameOrigin } from '../security.ts'
import { sweepSessions } from '../sessions.ts'
import { sweepSignupTokens } from '../signup/store.ts'
import { signInOptions, verifyAuthentication } from './ceremony.ts'
import { challengeOf, parseSignIn } from './input.ts'
import { rpFor } from './relying-party.ts'
import {
  findByCredentialId,
  hashChallenge,
  makeChallenge,
  recordUse,
  signInChallengeTimes,
  sweepChallenges,
  takeChallenge,
} from './store.ts'

const CHALLENGE_BODY_BYTES = 1024
const SIGN_IN_BODY_BYTES = 8 * 1024

const PASSKEY_ATTEMPT = ''

const fail = (status: number, error: SignInError) => noStoreJson(status, { error })

export async function handleSignInChallenge(request: Request): Promise<Response> {
  if (!isSameOrigin(request.headers, getConfig().appOrigin)) return forbidden()
  if (!(await readCapped(request, CHALLENGE_BODY_BYTES))) return fail(413, 'invalid')
  if (!isDatabaseConfigured()) return fail(503, 'unavailable')
  const ip = requestIp(request)
  try {
    const db = getDb()
    if (ip) {
      const now = new Date()
      const times = await signInChallengeTimes(db, ip, new Date(now.getTime() - PASSKEY_CHALLENGE_LIMIT.windowMs))
      if (overLimit(times, PASSKEY_CHALLENGE_LIMIT, now)) return fail(429, 'limited')
    }
    const challenge = await makeChallenge(db, { kind: 'sign-in', userId: null, ip })
    return noStoreJson(200, { options: await signInOptions({ rp: rpFor(getConfig().appOrigin), challenge }) })
  } catch (error) {
    logError('passkey challenge', error)
    return fail(503, 'unavailable')
  }
}

export async function handleSignIn(request: Request): Promise<Response> {
  if (!isSameOrigin(request.headers, getConfig().appOrigin)) return forbidden()
  const body = await readJsonBody(request, SIGN_IN_BODY_BYTES)
  if (!body.ok) return fail(PROBLEM_STATUS[body.reason], 'invalid')
  const input = parseSignIn(body.value)
  if (!input) return fail(400, 'invalid')
  if (!isDatabaseConfigured()) return fail(503, 'unavailable')
  const ip = requestIp(request)
  const db = getDb()
  try {
    const attempt = await beginAttempt(db, { username: PASSKEY_ATTEMPT, ip })
    if (await ipBlockedUntil(db, ip, attempt)) {
      await discardAttempt(db, attempt)
      await recordEvent(db, 'login.locked', { ip, detail: { reason: 'ip blocked', via: 'passkey' } })
      return fail(429, 'limited')
    }

    const refuse = async (reason: string, user?: { userId: number; username: string }) => {
      await recordEvent(db, 'login.failed', {
        userId: user?.userId ?? null,
        ip,
        detail: { ...(user ? { username: user.username } : {}), reason, via: 'passkey' },
      })
      return fail(401, 'refused')
    }

    const { credential } = input
    const challenge = challengeOf(credential)
    if (!challenge || !(await takeChallenge(db, hashChallenge(challenge), 'sign-in', null))) return refuse('challenge')
    const passkey = await findByCredentialId(db, Buffer.from(credential.id, 'base64url'))
    if (!passkey) return refuse('unknown credential')
    if (!passkey.userHandle || credential.response.userHandle !== passkey.userHandle.toString('base64url'))
      return refuse('user handle', passkey)
    if (passkey.disabled) return refuse('disabled', passkey)
    const verified = await verifyAuthentication({
      rp: rpFor(getConfig().appOrigin),
      credential,
      challenge: challenge.toString('base64url'),
      stored: passkey,
    })
    if (!verified.ok) return refuse(verified.reason, passkey)

    await recordUse(db, passkey.id, verified)
    const cookie = await startSession(db, request, passkey.userId)
    await markSucceeded(db, attempt)
    await recordEvent(db, 'login.succeeded', { userId: passkey.userId, ip, detail: { via: 'passkey' } })
    void Promise.all([
      sweepAttempts(db),
      sweepSessions(db),
      sweepAuditEvents(db),
      sweepSignupTokens(db),
      sweepPaddleEvents(db),
      sweepChallenges(db),
    ]).catch((error) => logError('sweep', error))
    return new Response(JSON.stringify({ next: safeNext(input.next) }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': NO_STORE, 'set-cookie': cookie },
    })
  } catch (error) {
    logError('passkey sign-in', error)
    return fail(503, 'unavailable')
  }
}
