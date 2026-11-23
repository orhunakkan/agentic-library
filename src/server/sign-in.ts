import '@tanstack/react-start/server-only'
import { sweepAccessTokens } from './access-tokens/store.ts'
import { recordEvent, sweepAuditEvents } from './audit.ts'
import { sweepPaddleEvents } from './billing/store.ts'
import type { Db } from './db.ts'
import {
  type Attempt,
  beginAttempt,
  discardAttempt,
  ipBlockedUntil,
  markSucceeded,
  sweepAttempts,
  usernameLockedUntil,
} from './login-attempts.ts'
import { dummyHash, hashPassword, needsRehash, verifyPassword } from './passwords.ts'
import { logError } from './redact.ts'
import { sweepSessions } from './sessions.ts'
import { sweepSignupTokens } from './signup/store.ts'
import { findUserByUsername, isValidUsername, setPasswordHash, type User } from './users.ts'

export const MAX_PASSWORD_FIELD = 1024

export type SignInRefusal = 'ip blocked' | 'username locked' | 'invalid'

export type SignInCheck = { ok: true; user: User; attempt: Attempt } | { ok: false; refusal: SignInRefusal }

async function lockReason(
  db: Db,
  username: string,
  ip: string | null,
  attempt: Attempt,
): Promise<'ip blocked' | 'username locked' | null> {
  if (await ipBlockedUntil(db, ip, attempt)) return 'ip blocked'
  if (await usernameLockedUntil(db, username, attempt)) return 'username locked'
  return null
}

export async function checkSignIn(
  db: Db,
  { username, password, ip, via }: { username: string; password: string; ip: string | null; via?: string },
): Promise<SignInCheck> {
  const tag = via === undefined ? {} : { via }
  const attempt = await beginAttempt(db, { username, ip })
  const refusal = await lockReason(db, username, ip, attempt)
  if (refusal) {
    await discardAttempt(db, attempt)
    await recordEvent(db, 'login.locked', { ip, detail: { username, reason: refusal, ...tag } })
    return { ok: false, refusal }
  }

  const fail = async (userId: number | null, reason: string): Promise<SignInCheck> => {
    await recordEvent(db, 'login.failed', { userId, ip, detail: { username, reason, ...tag } })
    if (await usernameLockedUntil(db, username))
      await recordEvent(db, 'login.locked', { userId, ip, detail: { username, reason: 'lock started', ...tag } })
    return { ok: false, refusal: 'invalid' }
  }

  if (!isValidUsername(username) || password.length > MAX_PASSWORD_FIELD) {
    await verifyPassword(password.slice(0, MAX_PASSWORD_FIELD), await dummyHash())
    return fail(null, 'malformed')
  }

  const user = await findUserByUsername(db, username)
  if (!user || user.disabledAt) {
    await verifyPassword(password, await dummyHash())
    return fail(user?.id ?? null, user ? 'disabled' : 'unknown user')
  }
  if (!(await verifyPassword(password, user.passwordHash))) return fail(user.id, 'wrong password')

  if (needsRehash(user.passwordHash)) await setPasswordHash(db, user.id, await hashPassword(password), false)
  return { ok: true, user, attempt }
}

export async function finishSignIn(
  db: Db,
  { attempt, userId, ip, via }: { attempt: Attempt; userId: number; ip: string | null; via?: string },
): Promise<void> {
  await markSucceeded(db, attempt)
  await recordEvent(db, 'login.succeeded', { userId, ip, ...(via === undefined ? {} : { detail: { via } }) })
  sweepAfterSignIn(db)
}

export function sweepAfterSignIn(db: Db): void {
  void Promise.all([
    sweepAttempts(db),
    sweepSessions(db),
    sweepAccessTokens(db),
    sweepAuditEvents(db),
    sweepSignupTokens(db),
    sweepPaddleEvents(db),
  ]).catch((error) => logError('sweep', error))
}
