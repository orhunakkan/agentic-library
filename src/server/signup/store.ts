import '@tanstack/react-start/server-only'
import { INVITE_DAYS, INVITE_MAX, MAX_SIGNUP_ATTEMPTS, SIGNUP_LINK_HOURS } from '../../shared/signup/signup.ts'
import { recordEvent } from '../audit.ts'
import type { Db, Pool } from '../db.ts'
import { isMarkedBounced } from '../mail/mail.ts'
import { SIGNUP_ADDRESS_LIMIT, SIGNUP_DAILY_LIMIT } from '../rate-limit.ts'
import { hashToken, newSessionToken } from '../security.ts'

export type SignupKind = 'email' | 'invite'

const live = (db: Db) =>
  db`t.used_at is null and t.expires_at > now() and t.revoked_at is null and t.bounced_at is null
    and t.attempts < ${MAX_SIGNUP_ATTEMPTS}`

const lockSignupTokens = (tx: Db) => tx`select pg_advisory_xact_lock(hashtext('signup_tokens'))`

export async function sweepSignupTokens(tx: Db): Promise<void> {
  await tx`
    delete from signup_tokens
    where (kind = 'email' and created_at < now() - interval '7 days')
      or (kind = 'invite' and least(expires_at, coalesce(used_at, 'infinity'), coalesce(revoked_at, 'infinity'))
        < now() - interval '30 days')`
}

const windowSecs = (ms: number) => ms / 1000

export async function dailySignupCount(db: Db): Promise<number> {
  const [row] = await db<{ n: string }[]>`
    select count(*) as n from signup_tokens
    where kind = 'email' and created_at > now() - make_interval(secs => ${windowSecs(SIGNUP_DAILY_LIMIT.windowMs)})`
  return Number(row?.n)
}

export function createSignupToken(
  pool: Pool,
  { email }: { email: string },
): Promise<{ id: string; token: string } | 'address' | 'busy'> {
  return pool.begin(async (tx) => {
    await lockSignupTokens(tx)
    const [address] = await tx<{ n: string }[]>`
      select count(*) as n from signup_tokens
      where lower(email) = lower(${email})
        and created_at > now() - make_interval(secs => ${windowSecs(SIGNUP_ADDRESS_LIMIT.windowMs)})`
    if (Number(address?.n) >= SIGNUP_ADDRESS_LIMIT.max) return 'address' as const
    if ((await dailySignupCount(tx)) >= SIGNUP_DAILY_LIMIT.max) return 'busy' as const
    await sweepSignupTokens(tx)
    const token = newSessionToken()
    const [row] = await tx<{ id: string }[]>`
      insert into signup_tokens (token_hash, kind, email, expires_at)
      values (${hashToken(token)}, 'email', ${email}, now() + make_interval(hours => ${SIGNUP_LINK_HOURS}))
      returning id`
    return { id: row?.id as string, token }
  })
}

export interface InviteRow {
  id: string
  note: string | null
  by: string | null
  createdAt: Date
  expiresAt: Date
}

export function createInvite(
  pool: Pool,
  { by, note }: { by: number; note: string | null },
): Promise<{ token: string; row: InviteRow } | 'quota'> {
  return pool.begin(async (tx) => {
    await lockSignupTokens(tx)
    const [pending] = await tx<{ n: string }[]>`
      select count(*) as n from signup_tokens t where t.kind = 'invite' and ${live(tx)}`
    if (Number(pending?.n) >= INVITE_MAX) return 'quota' as const
    await sweepSignupTokens(tx)
    const token = newSessionToken()
    const [row] = await tx<{ id: string; created_at: Date; expires_at: Date; by: string | null }[]>`
      with made as (
        insert into signup_tokens (token_hash, kind, note, created_by, expires_at)
        values (${hashToken(token)}, 'invite', ${note}, ${by}, now() + make_interval(days => ${INVITE_DAYS}))
        returning id, created_at, expires_at, created_by
      )
      select made.id, made.created_at, made.expires_at, u.username as by
      from made left join users u on u.id = made.created_by`
    if (!row) throw new Error('insert returned no row')
    return {
      token,
      row: { id: row.id, note, by: row.by, createdAt: row.created_at, expiresAt: row.expires_at },
    }
  })
}

export async function cancelSignupToken(db: Db, id: string): Promise<void> {
  await db`update signup_tokens set used_at = now() where id = ${id} and used_at is null`
}

export interface LiveSignupToken {
  id: string
  kind: SignupKind
  email: string | null
}

export async function findLiveSignupToken(db: Db, tokenHash: Buffer): Promise<LiveSignupToken | null> {
  const [row] = await db<LiveSignupToken[]>`
    select t.id, t.kind, t.email from signup_tokens t where t.token_hash = ${tokenHash} and ${live(db)}`
  return row ?? null
}

export async function countRefusal(db: Db, id: string): Promise<number> {
  const [row] = await db<{ attempts: number }[]>`
    update signup_tokens set attempts = least(attempts + 1, ${MAX_SIGNUP_ATTEMPTS}) where id = ${id}
    returning attempts`
  return row?.attempts ?? MAX_SIGNUP_ATTEMPTS
}

export async function pendingInvites(db: Db): Promise<InviteRow[]> {
  const rows = await db<{ id: string; note: string | null; by: string | null; created_at: Date; expires_at: Date }[]>`
    select t.id, t.note, u.username as by, t.created_at, t.expires_at
    from signup_tokens t left join users u on u.id = t.created_by
    where t.kind = 'invite' and ${live(db)}
    order by t.created_at desc, t.id`
  return rows.map((r) => ({ id: r.id, note: r.note, by: r.by, createdAt: r.created_at, expiresAt: r.expires_at }))
}

export async function revokeInvite(db: Db, id: string): Promise<'revoked' | 'missing'> {
  const rows = await db`
    update signup_tokens t set revoked_at = now() where t.id = ${id} and t.kind = 'invite' and ${live(db)}`
  return rows.count > 0 ? 'revoked' : 'missing'
}

export async function isSignupBounced(db: Db, email: string): Promise<boolean> {
  if (await isMarkedBounced(db, email)) return true
  const rows = await db`
    select 1 from signup_tokens where lower(email) = lower(${email}) and bounced_at is not null limit 1`
  return rows.length > 0
}

const MAX_NAMED_ACCOUNTS = 5

export async function accountsWithAddress(db: Db, email: string): Promise<string[]> {
  const rows = await db<{ username: string }[]>`
    select username from users
    where lower(email) = lower(${email}) and email_verified_at is not null and disabled_at is null
    order by username limit ${MAX_NAMED_ACCOUNTS}`
  return rows.map((r) => r.username)
}

export interface CreatedAccount {
  outcome: 'created'
  user: { id: number; username: string }
  kind: SignupKind
  by: number | null
}

export type CreateResult = CreatedAccount | { outcome: 'taken'; attempts: number } | { outcome: 'gone' }

export function createAccountFromToken(
  pool: Pool,
  {
    tokenHash,
    username,
    passwordHash,
    ip,
  }: { tokenHash: Buffer; username: string; passwordHash: string; ip: string | null },
): Promise<CreateResult> {
  return pool.begin(async (tx): Promise<CreateResult> => {
    const [token] = await tx<{ id: string; kind: SignupKind; email: string | null; created_by: string | null }[]>`
      select t.id, t.kind, t.email, t.created_by from signup_tokens t
      where t.token_hash = ${tokenHash} and ${live(tx)}
      for update`
    if (!token) return { outcome: 'gone' }
    const [user] = await tx<{ id: string; username: string }[]>`
      insert into users (username, password_hash, role, email, email_verified_at)
      values (${username}, ${passwordHash}, 'member', ${token.email},
        case when ${token.email}::text is null then null else now() end)
      on conflict (username) do nothing
      returning id, username`
    if (!user) return { outcome: 'taken', attempts: await countRefusal(tx, token.id) }
    const userId = Number(user.id)
    await tx`update signup_tokens set used_at = now(), used_by = ${userId} where id = ${token.id}`
    const by = token.created_by === null ? null : Number(token.created_by)
    const via = token.kind === 'email' ? 'sign-up' : 'invite'
    await recordEvent(tx, 'user.created', {
      userId,
      ip,
      detail: { via, role: 'member', ...(by === null ? {} : { by }) },
    })
    return { outcome: 'created', user: { id: userId, username: user.username }, kind: token.kind, by }
  })
}
