import '@tanstack/react-start/server-only'
import { endedDetail, endUserAccess } from '../access-tokens/store.ts'
import { recordEvent } from '../audit.ts'
import type { Db, Pool } from '../db.ts'
import { clearFailures } from '../login-attempts.ts'
import type { MailEventKind } from '../mail/webhook-input.ts'
import { removePasskeysForReset } from '../passkeys/store.ts'
import { type Limit, overLimit } from '../rate-limit.ts'
import { hashToken, newSessionToken } from '../security.ts'
import type { ResetIdentifier } from './input.ts'

export type TokenPurpose = 'verify' | 'reset'

const TOKEN_TTL_SECONDS: Record<TokenPurpose, number> = { verify: 24 * 60 * 60, reset: 30 * 60 }

export type BounceKind = MailEventKind

export interface AddressState {
  confirmed: { email: string; verifiedAt: Date } | null
  bounced: boolean
  pending: PendingAddress | null
}

export interface PendingAddress {
  id: number
  email: string
  bounced: boolean
}

export async function pendingAddress(db: Db, userId: number): Promise<PendingAddress | null> {
  const [row] = await db<{ id: string; email: string; bounced: boolean }[]>`
    select id, email, bounced_at is not null as bounced from email_tokens
    where user_id = ${userId} and purpose = 'verify' and used_at is null and expires_at > now()
    order by created_at desc, id desc limit 1`
  return row ? { id: Number(row.id), email: row.email, bounced: row.bounced } : null
}

export async function addressState(db: Db, userId: number): Promise<AddressState> {
  const [[user], pending] = await Promise.all([
    db<{ email: string | null; email_verified_at: Date | null; email_bounced_at: Date | null }[]>`
      select email, email_verified_at, email_bounced_at from users where id = ${userId}`,
    pendingAddress(db, userId),
  ])
  return {
    confirmed: user?.email && user.email_verified_at ? { email: user.email, verifiedAt: user.email_verified_at } : null,
    bounced: Boolean(user?.email && user.email_bounced_at),
    pending,
  }
}

export async function tokenTimes(db: Db, userId: number, purpose: TokenPurpose, since: Date): Promise<Date[]> {
  const rows = await db<{ created_at: Date }[]>`
    select created_at from email_tokens
    where user_id = ${userId} and purpose = ${purpose} and created_at > ${since}::timestamptz`
  return rows.map((r) => r.created_at)
}

export function createToken(
  pool: Pool,
  { userId, purpose, email, limit }: { userId: number; purpose: TokenPurpose; email: string; limit: Limit },
): Promise<{ id: number; token: string } | 'limit'> {
  return pool.begin(async (tx) => {
    await tx`select id from users where id = ${userId} for update`
    const now = new Date()
    const recent = await tokenTimes(tx, userId, purpose, new Date(now.getTime() - limit.windowMs))
    if (overLimit(recent, limit, now)) return 'limit' as const
    await tx`delete from email_tokens where created_at < now() - interval '7 days'`
    const token = newSessionToken()
    const [row] = await tx<{ id: string }[]>`
      insert into email_tokens (token_hash, user_id, purpose, email, expires_at)
      values (${hashToken(token)}, ${userId}, ${purpose}, ${email},
        now() + make_interval(secs => ${TOKEN_TTL_SECONDS[purpose]}))
      returning id`
    return { id: Number(row?.id), token }
  })
}

export async function cancelToken(db: Db, id: number): Promise<void> {
  await db`update email_tokens set used_at = now() where id = ${id} and used_at is null`
}

export async function supersedeTokens(db: Db, userId: number, purpose: TokenPurpose, keepId: number): Promise<void> {
  await db`
    update email_tokens set used_at = now()
    where user_id = ${userId} and purpose = ${purpose} and used_at is null and id <> ${keepId}`
}

export interface LiveToken {
  id: number
  userId: number
  email: string
}

export async function findLiveToken(db: Db, tokenHash: Buffer, purpose: TokenPurpose): Promise<LiveToken | null> {
  const [row] = await db<{ id: string; user_id: string; email: string }[]>`
    select id, user_id, email from email_tokens
    where token_hash = ${tokenHash} and purpose = ${purpose} and used_at is null and expires_at > now()
      and bounced_at is null`
  return row ? { id: Number(row.id), userId: Number(row.user_id), email: row.email } : null
}

export interface ResetToken extends LiveToken {
  username: string
}

export async function findLiveResetToken(db: Db, tokenHash: Buffer): Promise<ResetToken | null> {
  const [row] = await db<{ id: string; user_id: string; email: string; username: string }[]>`
    select t.id, t.user_id, t.email, u.username from email_tokens t join users u on u.id = t.user_id
    where t.token_hash = ${tokenHash} and t.purpose = 'reset' and t.used_at is null and t.expires_at > now()
      and t.created_at > u.password_changed_at and lower(t.email) = lower(u.email)
      and u.disabled_at is null and u.email_bounced_at is null`
  return row ? { id: Number(row.id), userId: Number(row.user_id), email: row.email, username: row.username } : null
}

export interface ResetCandidate {
  id: number
  username: string
  email: string | null
  disabled: boolean
  bounced: boolean
}

const MAX_RESET_ACCOUNTS = 5

export async function accountsForReset(db: Db, identifier: ResetIdentifier): Promise<ResetCandidate[]> {
  const rows = await db<{ id: string; username: string; email: string | null; disabled: boolean; bounced: boolean }[]>`
    select id, username, email, disabled_at is not null as disabled, email_bounced_at is not null as bounced
    from users
    where ${identifier.by === 'username' ? db`username = ${identifier.username}` : db`lower(email) = lower(${identifier.email})`}
    order by id limit ${MAX_RESET_ACCOUNTS}`
  return rows.map((r) => ({ ...r, id: Number(r.id) }))
}

export function resetPassword(
  pool: Pool,
  { tokenId, userId, passwordHash, ip }: { tokenId: number; userId: number; passwordHash: string; ip: string | null },
): Promise<{ username: string; email: string } | 'invalid'> {
  return pool.begin(async (tx) => {
    const [row] = await tx<{ username: string; email: string }[]>`
      select u.username, t.email from users u join email_tokens t on t.user_id = u.id
      where u.id = ${userId} and t.id = ${tokenId} and t.purpose = 'reset' and t.used_at is null
        and t.expires_at > now() and t.created_at > u.password_changed_at and lower(t.email) = lower(u.email)
        and u.disabled_at is null and u.email_bounced_at is null
      for update of u, t`
    if (!row) return 'invalid' as const
    await tx`update users set password_hash = ${passwordHash}, password_changed_at = now() where id = ${userId}`
    await tx`update email_tokens set used_at = now() where id = ${tokenId}`
    await removePasskeysForReset(tx, userId, { ip, detail: { via: 'reset link' } })
    const ended = await endUserAccess(tx, userId, { via: 'reset', ip })
    await clearFailures(tx, row.username)
    await recordEvent(tx, 'password.changed', { userId, ip, detail: { via: 'reset link', ...endedDetail(ended) } })
    return row
  })
}

export interface Confirmed {
  email: string
  previous: { email: string; bounced: boolean } | null
}

export function confirmAddress(
  pool: Pool,
  { tokenId, userId, ip }: { tokenId: number; userId: number; ip: string | null },
): Promise<Confirmed | 'invalid'> {
  return pool.begin(async (tx) => {
    const [user] = await tx<{ email: string | null; email_bounced_at: Date | null }[]>`
      select email, email_bounced_at from users where id = ${userId} for update`
    const [token] = await tx<{ email: string }[]>`
      select email from email_tokens
      where id = ${tokenId} and user_id = ${userId} and purpose = 'verify' and used_at is null and expires_at > now()
        and bounced_at is null
      for update`
    if (!user || !token) return 'invalid' as const
    await tx`
      update users set email = ${token.email}, email_verified_at = now(), email_bounced_at = null where id = ${userId}`
    await tx`update email_tokens set used_at = now() where user_id = ${userId} and used_at is null`
    await recordEvent(tx, 'email.verified', { userId, ip, detail: { replaced: user.email !== null } })
    return {
      email: token.email,
      previous: user.email ? { email: user.email, bounced: user.email_bounced_at !== null } : null,
    }
  })
}

export function removeAddress(pool: Pool, userId: number, { pendingOnly }: { pendingOnly: boolean }): Promise<boolean> {
  return pool.begin(async (tx) => {
    const tokens = pendingOnly
      ? await tx`update email_tokens set used_at = now()
          where user_id = ${userId} and purpose = 'verify' and used_at is null`
      : await tx`update email_tokens set used_at = now() where user_id = ${userId} and used_at is null`
    if (pendingOnly) return tokens.count > 0
    const users = await tx`
      update users set email = null, email_verified_at = null, email_bounced_at = null
      where id = ${userId} and email is not null`
    return users.count > 0 || tokens.count > 0
  })
}

export function markBounced(pool: Pool, email: string, kind: BounceKind): Promise<number> {
  return pool.begin(async (tx) => {
    const users = await tx<{ id: string }[]>`
      update users set email_bounced_at = now()
      where lower(email) = lower(${email}) and email_bounced_at is null
      returning id`
    const tokens = await tx<{ user_id: string }[]>`
      update email_tokens set bounced_at = now()
      where lower(email) = lower(${email}) and purpose = 'verify' and used_at is null and bounced_at is null
      returning user_id`
    await tx`
      update signup_tokens set bounced_at = now()
      where lower(email) = lower(${email}) and used_at is null and bounced_at is null`
    const accounts = new Set([...users.map((u) => Number(u.id)), ...tokens.map((t) => Number(t.user_id))])
    for (const userId of accounts) await recordEvent(tx, 'email.bounced', { userId, detail: { kind } })
    return accounts.size
  })
}
