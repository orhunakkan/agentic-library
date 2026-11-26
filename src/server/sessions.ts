import '@tanstack/react-start/server-only'
import type { Db } from './db.ts'
import type { Role } from './users.ts'

const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60
export const SESSION_IDLE = '7 days'
const TOUCH_EVERY = '10 minutes'

export interface SessionUser {
  userId: number
  username: string
  role: Role
  expiresAt: Date
}

export async function createSession(
  db: Db,
  { tokenHash, userId, ip, userAgent }: { tokenHash: Buffer; userId: number; ip: string | null; userAgent: string },
): Promise<{ expiresAt: Date }> {
  const [row] = await db<{ expires_at: Date }[]>`
    insert into sessions (token_hash, user_id, expires_at, ip, user_agent)
    values (${tokenHash}, ${userId}, now() + make_interval(secs => ${SESSION_MAX_AGE_SECONDS}), ${ip},
      ${userAgent.slice(0, 300)})
    returning expires_at`
  if (!row) throw new Error('insert returned no row')
  return { expiresAt: row.expires_at }
}

export async function findSession(db: Db, tokenHash: Buffer): Promise<SessionUser | null> {
  const [row] = await db<
    { user_id: string; username: string; role: Role; expires_at: Date; ended: boolean; stale: boolean }[]
  >`
    select s.user_id, u.username, u.role, s.expires_at,
      (s.expires_at <= now() or s.last_seen_at <= now() - ${SESSION_IDLE}::interval or u.disabled_at is not null)
        as ended,
      s.last_seen_at <= now() - ${TOUCH_EVERY}::interval as stale
    from sessions s join users u on u.id = s.user_id
    where s.token_hash = ${tokenHash}`
  if (!row) return null
  if (row.ended) {
    await deleteSession(db, tokenHash)
    return null
  }
  if (row.stale) await db`update sessions set last_seen_at = now() where token_hash = ${tokenHash}`
  return {
    userId: Number(row.user_id),
    username: row.username,
    role: row.role,
    expiresAt: row.expires_at,
  }
}

export async function deleteSession(db: Db, tokenHash: Buffer): Promise<void> {
  await db`delete from sessions where token_hash = ${tokenHash}`
}

export async function deleteUserSessions(db: Db, userId: number, keep?: Buffer): Promise<number> {
  const result = keep
    ? await db`delete from sessions where user_id = ${userId} and token_hash <> ${keep}`
    : await db`delete from sessions where user_id = ${userId}`
  return result.count
}

export interface SessionInfo {
  current: boolean
  createdAt: Date
  lastSeenAt: Date
  ip: string | null
  userAgent: string | null
}

export async function listSessions(db: Db, userId: number, current: Buffer): Promise<SessionInfo[]> {
  const rows = await db<
    { current: boolean; created_at: Date; last_seen_at: Date; ip: string | null; user_agent: string | null }[]
  >`
    select token_hash = ${current} as current, created_at, last_seen_at, host(ip) as ip, user_agent
    from sessions
    where user_id = ${userId} and expires_at > now() and last_seen_at > now() - ${SESSION_IDLE}::interval
    order by (token_hash = ${current}) desc, last_seen_at desc`
  return rows.map((session) => ({
    current: session.current,
    createdAt: session.created_at,
    lastSeenAt: session.last_seen_at,
    ip: session.ip,
    userAgent: session.user_agent,
  }))
}

export async function sweepSessions(db: Db): Promise<void> {
  await db`delete from sessions where expires_at <= now() or last_seen_at <= now() - ${SESSION_IDLE}::interval`
}
