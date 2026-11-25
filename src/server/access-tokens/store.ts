import '@tanstack/react-start/server-only'
import { recordEvent } from '../audit.ts'
import type { Db, Pool } from '../db.ts'
import { planFor, proSql } from '../plans/plan.ts'
import { deleteUserSessions, SESSION_IDLE, type SessionUser } from '../sessions.ts'
import type { Role } from '../users.ts'

export const MAX_ACCESS_TOKENS = 10
const TOUCH_EVERY = '10 minutes'

export type RevokeVia =
  | 'self'
  | 'account page'
  | 'password change'
  | 'reset'
  | 'admin'
  | 'script'
  | 'sign out everywhere'

export interface AccessTokenRow {
  id: string
  name: string
  createdAt: Date
  lastUsedAt: Date | null
  expiresAt: Date
}

interface Raw {
  id: string
  name: string
  created_at: Date
  last_used_at: Date | null
  expires_at: Date
}

const toRow = (accessToken: Raw): AccessTokenRow => ({
  id: accessToken.id,
  name: accessToken.name,
  createdAt: accessToken.created_at,
  lastUsedAt: accessToken.last_used_at,
  expiresAt: accessToken.expires_at,
})

export interface TokenUser extends SessionUser {
  tokenId: string
}

export async function createAccessToken(
  pool: Pool,
  {
    userId,
    tokenHash,
    name,
    days,
    ip,
    userAgent,
  }: { userId: number; tokenHash: Buffer; name: string; days: number; ip: string | null; userAgent: string },
): Promise<AccessTokenRow | 'quota'> {
  return pool.begin(async (tx) => {
    await tx`select id from users where id = ${userId} for update`
    await tx`
      delete from access_tokens
      where user_id = ${userId}
        and (expires_at <= now() or coalesce(last_used_at, created_at) <= now() - ${SESSION_IDLE}::interval)`
    const [count] = await tx<{ n: string }[]>`select count(*) as n from access_tokens where user_id = ${userId}`
    if (Number(count?.n ?? 0) >= MAX_ACCESS_TOKENS) return 'quota' as const
    const [row] = await tx<Raw[]>`
      insert into access_tokens (user_id, token_hash, name, expires_at, ip, user_agent)
      values (${userId}, ${tokenHash}, ${name}, now() + make_interval(days => ${days}), ${ip},
        ${userAgent.slice(0, 300)})
      returning id, name, created_at, last_used_at, expires_at`
    if (!row) throw new Error('insert returned no row')
    return toRow(row)
  })
}

export async function findAccessToken(db: Db, tokenHash: Buffer): Promise<TokenUser | null> {
  const [row] = await db<
    {
      id: string
      user_id: string
      username: string
      role: Role
      pro: boolean
      expires_at: Date
      ended: boolean
      stale: boolean
    }[]
  >`
    select t.id, t.user_id, u.username, u.role, ${proSql(db)} as pro, t.expires_at,
      (t.expires_at <= now() or coalesce(t.last_used_at, t.created_at) <= now() - ${SESSION_IDLE}::interval
        or u.disabled_at is not null) as ended,
      (t.last_used_at is null or t.last_used_at <= now() - ${TOUCH_EVERY}::interval) as stale
    from access_tokens t join users u on u.id = t.user_id
    where t.token_hash = ${tokenHash}`
  if (!row) return null
  if (row.ended) {
    await db`delete from access_tokens where id = ${row.id}`
    return null
  }
  if (row.stale) await db`update access_tokens set last_used_at = now() where id = ${row.id}`
  return {
    tokenId: row.id,
    userId: Number(row.user_id),
    username: row.username,
    role: row.role,
    plan: planFor(row.pro),
    expiresAt: row.expires_at,
  }
}

export async function listAccessTokens(db: Db, userId: number): Promise<AccessTokenRow[]> {
  const rows = await db<Raw[]>`
    select id, name, created_at, last_used_at, expires_at from access_tokens
    where user_id = ${userId} and expires_at > now()
      and coalesce(last_used_at, created_at) > now() - ${SESSION_IDLE}::interval
    order by created_at desc, id`
  return rows.map(toRow)
}

export async function revokeAccessToken(db: Db, userId: number, id: string): Promise<boolean> {
  const result = await db`delete from access_tokens where user_id = ${userId} and id = ${id}`
  return result.count > 0
}

export interface AccessEnded {
  sessionsEnded: number
  tokensEnded: number
}

export async function endUserAccess(
  db: Db,
  userId: number,
  { keep, via, ip = null }: { keep?: Buffer; via: RevokeVia; ip?: string | null },
): Promise<AccessEnded> {
  const sessionsEnded = await deleteUserSessions(db, userId, keep)
  const tokens = await db<{ id: string }[]>`delete from access_tokens where user_id = ${userId} returning id`
  for (const { id } of tokens) await recordEvent(db, 'token.revoked', { userId, ip, detail: { id, via } })
  return { sessionsEnded, tokensEnded: tokens.length }
}

export function endedDetail({ sessionsEnded, tokensEnded }: AccessEnded): {
  sessionsEnded: number
  tokensEnded?: number
} {
  return tokensEnded > 0 ? { sessionsEnded, tokensEnded } : { sessionsEnded }
}

export async function sweepAccessTokens(db: Db): Promise<void> {
  await db`
    delete from access_tokens
    where expires_at <= now() or coalesce(last_used_at, created_at) <= now() - ${SESSION_IDLE}::interval`
}
