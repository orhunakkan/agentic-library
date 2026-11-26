import '@tanstack/react-start/server-only'
import { type EmailStatus, emailStatus } from '../../shared/admin/users.ts'
import { endedDetail, endUserAccess } from '../access-tokens/store.ts'
import { forgetUserAudio } from '../audiobooks/files.ts'
import { recordEvent } from '../audit.ts'
import type { Db, Pool } from '../db.ts'
import { usernameLockedUntil } from '../login-attempts.ts'
import { SESSION_IDLE } from '../sessions.ts'
import { createUser, type Role, type User } from '../users.ts'

interface Target {
  id: number
  username: string
  role: Role
  enabledAdmin: boolean
}

async function lockForChange(tx: Db, userId: number): Promise<{ target: Target; onlyAdmin: boolean } | null> {
  const admins = await tx<{ id: string }[]>`
    select id from users where role = 'admin' and disabled_at is null order by id for update`
  const [row] = await tx<{ id: string; username: string; role: Role; disabled_at: Date | null }[]>`
    select id, username, role, disabled_at from users where id = ${userId} for update`
  if (!row) return null
  const enabledAdmin = row.role === 'admin' && row.disabled_at === null
  const others = admins.filter((a) => Number(a.id) !== userId).length
  return {
    target: { id: Number(row.id), username: row.username, role: row.role, enabledAdmin },
    onlyAdmin: enabledAdmin && others === 0,
  }
}

export type DeleteResult = 'deleted' | 'last_admin' | 'missing'

export async function deleteAccount(
  pool: Pool,
  userId: number,
  audit: { ip?: string | null; detail: Record<string, unknown> },
): Promise<DeleteResult> {
  const result = await pool.begin(async (tx): Promise<DeleteResult> => {
    const locked = await lockForChange(tx, userId)
    if (!locked) return 'missing'
    if (locked.onlyAdmin) return 'last_admin'
    const { target } = locked
    await tx`delete from users where id = ${target.id}`
    await tx`delete from login_attempts where username = ${target.username}`
    await recordEvent(tx, 'user.deleted', {
      userId: null,
      ip: audit.ip ?? null,
      detail: { username: target.username, role: target.role, ...audit.detail },
    })
    return 'deleted'
  })
  if (result === 'deleted') await forgetUserAudio(userId)
  return result
}

export type RoleResult = { from: Role; to: Role } | 'last_admin' | 'missing'

export function setRole(pool: Pool, userId: number, role: Role): Promise<RoleResult> {
  return pool.begin(async (tx): Promise<RoleResult> => {
    const locked = await lockForChange(tx, userId)
    if (!locked) return 'missing'
    if (role !== 'admin' && locked.onlyAdmin) return 'last_admin'
    if (locked.target.role !== role) await tx`update users set role = ${role} where id = ${userId}`
    return { from: locked.target.role, to: role }
  })
}

export type DisableResult = { sessionsEnded: number; tokensEnded?: number } | 'last_admin' | 'missing'

export function setDisabledGuarded(
  pool: Pool,
  userId: number,
  disabled: boolean,
  { via = 'admin', ip = null }: { via?: 'admin' | 'script'; ip?: string | null } = {},
): Promise<DisableResult> {
  return pool.begin(async (tx): Promise<DisableResult> => {
    const locked = await lockForChange(tx, userId)
    if (!locked) return 'missing'
    if (!disabled) {
      await tx`update users set disabled_at = null where id = ${userId}`
      return { sessionsEnded: 0 }
    }
    if (locked.onlyAdmin) return 'last_admin'
    await tx`update users set disabled_at = coalesce(disabled_at, now()) where id = ${userId}`
    return endedDetail(await endUserAccess(tx, userId, { via, ip }))
  })
}

export async function addUser(db: Db, username: string, passwordHash: string, role: Role): Promise<User | 'taken'> {
  try {
    return await createUser(db, username, passwordHash, role)
  } catch (error) {
    if ((error as { code?: string }).code === '23505') return 'taken'
    throw error
  }
}

export interface AdminUserRow {
  id: number
  username: string
  role: Role
  createdAt: Date
  passwordChangedAt: Date
  disabledAt: Date | null
  lastActiveAt: Date | null
  sessions: number
  hasKey: boolean
  email: EmailStatus
  lockedUntil: Date | null
  you: boolean
}

export async function listForAdmin(db: Db, viewerId: number, username?: string): Promise<AdminUserRow[]> {
  const rows = await db<
    {
      id: string
      username: string
      role: Role
      created_at: Date
      password_changed_at: Date
      disabled_at: Date | null
      last_active_at: Date | null
      sessions: string
      has_key: boolean
      has_email: boolean
      email_bounced: boolean
    }[]
  >`
    select u.id, u.username, u.role, u.created_at, u.password_changed_at, u.disabled_at, live.last_active_at,
      coalesce(live.sessions, 0) as sessions,
      exists (select 1 from api_keys k where k.user_id = u.id) as has_key,
      u.email is not null as has_email, u.email_bounced_at is not null as email_bounced
    from users u
    left join lateral (
      select max(s.last_seen_at) as last_active_at, count(*) as sessions from sessions s
      where s.user_id = u.id and s.expires_at > now() and s.last_seen_at > now() - ${SESSION_IDLE}::interval
    ) live on true
    ${username === undefined ? db`` : db`where u.username = ${username}`}
    order by u.username`
  return Promise.all(
    rows.map(async (user) => ({
      id: Number(user.id),
      username: user.username,
      role: user.role,
      createdAt: user.created_at,
      passwordChangedAt: user.password_changed_at,
      disabledAt: user.disabled_at,
      lastActiveAt: user.last_active_at,
      sessions: Number(user.sessions),
      hasKey: user.has_key,
      email: emailStatus(user.has_email, user.email_bounced),
      lockedUntil: await usernameLockedUntil(db, user.username),
      you: Number(user.id) === viewerId,
    })),
  )
}
