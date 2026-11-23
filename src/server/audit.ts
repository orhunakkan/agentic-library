import '@tanstack/react-start/server-only'
import type { Db } from './db.ts'

export type AuditEvent =
  | 'login.succeeded'
  | 'login.failed'
  | 'login.locked'
  | 'logout'
  | 'sessions.revoked'
  | 'password.changed'
  | 'api_key.saved'
  | 'api_key.deleted'
  | 'api_key.rejected'
  | 'user.created'
  | 'user.disabled'
  | 'user.enabled'
  | 'user.unlocked'
  | 'user.deleted'
  | 'user.role_changed'
  | 'account.exported'
  | 'book.imported'
  | 'article.saved'
  | 'book.deleted'
  | 'ai_model.changed'
  | 'speech_model.changed'
  | 'book.asked'
  | 'book.details_changed'
  | 'book.cover_changed'
  | 'book.looked_up'
  | 'word.looked_up'
  | 'word.translated'
  | 'email.verification_sent'
  | 'email.verified'
  | 'email.removed'
  | 'email.bounced'
  | 'password.reset_requested'
  | 'signup.requested'
  | 'signup.refused'
  | 'invite.created'
  | 'invite.revoked'
  | 'plan.granted'
  | 'plan.revoked'
  | 'billing.checkout'
  | 'billing.subscription'
  | 'passkey.added'
  | 'passkey.removed'
  | 'passkey.refused'
  | 'token.created'
  | 'token.revoked'
  | 'repo.added'
  | 'repo.refreshed'
  | 'repo.removed'

export async function recordEvent(
  db: Db,
  event: AuditEvent,
  { userId = null, ip = null, detail = {} }: { userId?: number | null; ip?: string | null; detail?: object },
): Promise<void> {
  await db`
    insert into audit_events (user_id, event, ip, detail)
    values (${userId}, ${event}, ${ip}, ${db.json(detail as never)})`
}

export async function sweepAuditEvents(db: Db): Promise<number> {
  const rows = await db`delete from audit_events where at < now() - interval '365 days'`
  return rows.count
}

export async function ipEventTimes(db: Db, ip: string, event: AuditEvent, since: Date): Promise<Date[]> {
  const rows = await db<{ at: Date }[]>`
    select at from audit_events where event = ${event} and ip = ${ip}::inet and at > ${since}::timestamptz`
  return rows.map((r) => r.at)
}

export async function eventTimes(db: Db, userId: number, events: AuditEvent[], since: Date): Promise<Date[]> {
  const rows = await db<{ at: Date }[]>`
    select at from audit_events
    where user_id = ${userId} and event = any(${events}::text[]) and at > ${since}::timestamptz`
  return rows.map((r) => r.at)
}
