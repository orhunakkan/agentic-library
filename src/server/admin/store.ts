import '@tanstack/react-start/server-only'
import { type EmailStatus, emailStatus } from '../../shared/admin/users.ts'
import { PRO_STATUSES } from '../../shared/billing/billing.ts'
import type { PaidLabel } from '../../shared/plans/copy.ts'
import { endedDetail, endUserAccess } from '../access-tokens/store.ts'
import { forgetUserAudio } from '../audiobooks/files.ts'
import { recordEvent } from '../audit.ts'
import { cancelNow, getSubscription, type PaddleOptions } from '../billing/paddle-api.ts'
import { billableSubscriptions, detachUser } from '../billing/store.ts'
import { getConfig } from '../config.ts'
import type { Db, Pool } from '../db.ts'
import { usernameLockedUntil } from '../login-attempts.ts'
import { logError } from '../redact.ts'
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

export type DeleteResult = 'deleted' | 'last_admin' | 'missing' | 'billing_failed'

export interface DeleteOptions {
  skipBilling?: boolean
  paddle?: PaddleOptions
}

async function cancelBilling(db: Db, userId: number, paddle: PaddleOptions = {}): Promise<boolean> {
  if (!(paddle.config ?? getConfig().billing)) return true
  for (const id of await billableSubscriptions(db, userId)) {
    try {
      await cancelNow(id, paddle)
    } catch (error) {
      const status = await getSubscription(id, paddle).then(
        (entity) => (entity as { status?: unknown } | null)?.status,
        () => null,
      )
      if (status === 'canceled') continue
      logError('cancel subscription before deleting an account', error)
      return false
    }
  }
  return true
}

export async function deleteAccount(
  pool: Pool,
  userId: number,
  audit: { ip?: string | null; detail: Record<string, unknown> },
  options: DeleteOptions = {},
): Promise<DeleteResult> {
  const early = await pool.begin(async (tx) => lockForChange(tx, userId))
  if (!early) return 'missing'
  if (early.onlyAdmin) return 'last_admin'
  if (!options.skipBilling && !(await cancelBilling(pool, userId, options.paddle))) return 'billing_failed'
  const result = await pool.begin(async (tx): Promise<DeleteResult> => {
    const locked = await lockForChange(tx, userId)
    if (!locked) return 'missing'
    if (locked.onlyAdmin) return 'last_admin'
    const { target } = locked
    await detachUser(tx, target.id)
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
  given: boolean
  paid: PaidLabel | null
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
      given: boolean
      paid_cadence: 'month' | 'year' | null
      paid_founding: boolean | null
      paid_status: string | null
    }[]
  >`
    select u.id, u.username, u.role, u.created_at, u.password_changed_at, u.disabled_at, live.last_active_at,
      coalesce(live.sessions, 0) as sessions,
      exists (select 1 from api_keys k where k.user_id = u.id) as has_key,
      u.email is not null as has_email, u.email_bounced_at is not null as email_bounced,
      u.pro_granted_at is not null as given,
      paid.cadence as paid_cadence, paid.founding as paid_founding, paid.status as paid_status
    from users u
    left join lateral (
      select s.cadence, s.founding, s.status from subscriptions s
      where s.user_id = u.id and s.status = any(${[...PRO_STATUSES]}::text[])
      order by s.created_at desc limit 1
    ) paid on true
    left join lateral (
      select max(s.last_seen_at) as last_active_at, count(*) as sessions from sessions s
      where s.user_id = u.id and s.expires_at > now() and s.last_seen_at > now() - ${SESSION_IDLE}::interval
    ) live on true
    ${username === undefined ? db`` : db`where u.username = ${username}`}
    order by u.username`
  return Promise.all(
    rows.map(async (r) => ({
      id: Number(r.id),
      username: r.username,
      role: r.role,
      createdAt: r.created_at,
      passwordChangedAt: r.password_changed_at,
      disabledAt: r.disabled_at,
      lastActiveAt: r.last_active_at,
      sessions: Number(r.sessions),
      hasKey: r.has_key,
      email: emailStatus(r.has_email, r.email_bounced),
      given: r.given,
      paid: r.paid_cadence
        ? { cadence: r.paid_cadence, founding: r.paid_founding === true, pastDue: r.paid_status === 'past_due' }
        : null,
      lockedUntil: await usernameLockedUntil(db, r.username),
      you: Number(r.id) === viewerId,
    })),
  )
}
