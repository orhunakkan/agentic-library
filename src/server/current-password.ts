import '@tanstack/react-start/server-only'
import { recordEvent } from './audit.ts'
import type { Db } from './db.ts'
import { beginAttempt, discardAttempt, markSucceeded, usernameLockedUntil } from './login-attempts.ts'
import { verifyPassword } from './passwords.ts'
import type { SessionUser } from './sessions.ts'
import { findUserById } from './users.ts'

const MAX_FIELD = 1024

export type RecheckVia = 'change password' | 'delete account' | 'email' | 'passkey'

export async function checkCurrentPassword(
  db: Db,
  session: SessionUser,
  password: string,
  ip: string | null,
  via: RecheckVia,
): Promise<boolean> {
  const attempt = await beginAttempt(db, { username: session.username, ip })
  if (await usernameLockedUntil(db, session.username, attempt)) {
    await discardAttempt(db, attempt)
    await recordEvent(db, 'login.locked', {
      userId: session.userId,
      ip,
      detail: { username: session.username, reason: 'username locked', via },
    })
    return false
  }
  const user = await findUserById(db, session.userId)
  if (!user || password.length > MAX_FIELD || !(await verifyPassword(password, user.passwordHash))) return false
  await markSucceeded(db, attempt)
  return true
}
