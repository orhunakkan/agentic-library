import '@tanstack/react-start/server-only'
import { type EmailStatus, emailStatus } from '../shared/admin/users.ts'
import { PRO_STATUSES } from '../shared/billing/billing.ts'
import { type AiModelId, resolveAiModel } from '../shared/lib/ai-models.ts'
import { resolveSpeechModel, type SpeechModelId } from '../shared/lib/speech-models.ts'
import type { PaidLabel } from '../shared/plans/copy.ts'
import { USERNAME_PATTERN } from '../shared/signup/signup.ts'
import type { Db } from './db.ts'
import { SESSION_IDLE } from './sessions.ts'

export type Role = 'admin' | 'member'
export const ROLES: readonly Role[] = ['admin', 'member']

export interface User {
  id: number
  username: string
  passwordHash: string
  role: Role
  createdAt: Date
  passwordChangedAt: Date
  disabledAt: Date | null
  aiModel: AiModelId
  email: string | null
  emailVerifiedAt: Date | null
  emailBouncedAt: Date | null
}

export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase()
}

export function isValidUsername(username: string): boolean {
  return USERNAME_PATTERN.test(username)
}

interface UserRow {
  id: string
  username: string
  password_hash: string
  role: Role
  created_at: Date
  password_changed_at: Date
  disabled_at: Date | null
  ai_model: string | null
  email: string | null
  email_verified_at: Date | null
  email_bounced_at: Date | null
}

const toUser = (r: UserRow): User => ({
  id: Number(r.id),
  username: r.username,
  passwordHash: r.password_hash,
  role: r.role,
  createdAt: r.created_at,
  passwordChangedAt: r.password_changed_at,
  disabledAt: r.disabled_at,
  aiModel: resolveAiModel(r.ai_model),
  email: r.email,
  emailVerifiedAt: r.email_verified_at,
  emailBouncedAt: r.email_bounced_at,
})

export async function findUserByUsername(db: Db, username: string): Promise<User | null> {
  const [row] = await db<UserRow[]>`select * from users where username = ${normalizeUsername(username)}`
  return row ? toUser(row) : null
}

export async function findUserById(db: Db, id: number): Promise<User | null> {
  const [row] = await db<UserRow[]>`select * from users where id = ${id}`
  return row ? toUser(row) : null
}

export async function createUser(db: Db, username: string, passwordHash: string, role: Role): Promise<User> {
  const [row] = await db<UserRow[]>`
    insert into users (username, password_hash, role)
    values (${normalizeUsername(username)}, ${passwordHash}, ${role})
    returning *`
  if (!row) throw new Error('insert returned no row')
  return toUser(row)
}

export async function setPasswordHash(db: Db, userId: number, passwordHash: string, changed = true): Promise<void> {
  await db`
    update users set password_hash = ${passwordHash},
      password_changed_at = case when ${changed}::boolean then now() else password_changed_at end
    where id = ${userId}`
}

export async function setDisabled(db: Db, userId: number, disabled: boolean): Promise<void> {
  await db`
    update users set disabled_at = case when ${disabled}::boolean then coalesce(disabled_at, now()) else null end
    where id = ${userId}`
}

export async function getAiModel(db: Db, userId: number): Promise<AiModelId> {
  const [row] = await db<{ ai_model: string | null }[]>`select ai_model from users where id = ${userId}`
  return resolveAiModel(row?.ai_model)
}

export async function setAiModel(db: Db, userId: number, model: AiModelId): Promise<AiModelId> {
  const [row] = await db<{ previous: string | null }[]>`
    update users u set ai_model = ${model}
    from (select ai_model as previous from users where id = ${userId} for update) old
    where u.id = ${userId}
    returning old.previous`
  return resolveAiModel(row?.previous)
}

export async function getSpeechModel(db: Db, userId: number): Promise<SpeechModelId> {
  const [row] = await db<{ speech_model: string | null }[]>`select speech_model from users where id = ${userId}`
  return resolveSpeechModel(row?.speech_model)
}

export async function setSpeechModel(db: Db, userId: number, model: SpeechModelId): Promise<SpeechModelId> {
  const [row] = await db<{ previous: string | null }[]>`
    update users u set speech_model = ${model}
    from (select speech_model as previous from users where id = ${userId} for update) old
    where u.id = ${userId}
    returning old.previous`
  return resolveSpeechModel(row?.previous)
}

export interface UserSummary {
  username: string
  role: Role
  createdAt: Date
  disabledAt: Date | null
  activeSessions: number
  hasApiKey: boolean
  email: EmailStatus
  proGiven: boolean
  paid: PaidLabel | null
}

export async function listUsers(db: Db): Promise<UserSummary[]> {
  const rows = await db<
    {
      username: string
      role: Role
      created_at: Date
      disabled_at: Date | null
      active_sessions: string
      has_api_key: boolean
      has_email: boolean
      email_bounced: boolean
      pro_given: boolean
      paid_cadence: 'month' | 'year' | null
      paid_founding: boolean | null
      paid_status: string | null
    }[]
  >`
    select u.username, u.role, u.created_at, u.disabled_at, u.pro_granted_at is not null as pro_given,
      paid.cadence as paid_cadence, paid.founding as paid_founding, paid.status as paid_status,
      (select count(*) from sessions s where s.user_id = u.id and s.expires_at > now()
        and s.last_seen_at > now() - ${SESSION_IDLE}::interval) as active_sessions,
      exists (select 1 from api_keys k where k.user_id = u.id) as has_api_key,
      u.email is not null as has_email, u.email_bounced_at is not null as email_bounced
    from users u
    left join lateral (
      select s.cadence, s.founding, s.status from subscriptions s
      where s.user_id = u.id and s.status = any(${[...PRO_STATUSES]}::text[])
      order by s.created_at desc limit 1
    ) paid on true
    order by u.username`
  return rows.map((r) => ({
    username: r.username,
    role: r.role,
    createdAt: r.created_at,
    disabledAt: r.disabled_at,
    activeSessions: Number(r.active_sessions),
    hasApiKey: r.has_api_key,
    email: emailStatus(r.has_email, r.email_bounced),
    proGiven: r.pro_given,
    paid: r.paid_cadence
      ? { cadence: r.paid_cadence, founding: r.paid_founding === true, pastDue: r.paid_status === 'past_due' }
      : null,
  }))
}
