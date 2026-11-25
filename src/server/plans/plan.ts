import '@tanstack/react-start/server-only'
import { PRO_STATUSES } from '../../shared/billing/billing.ts'
import { proNotice } from '../../shared/plans/copy.ts'
import { canUse, type Plan, type PlanSource, type ProFeature } from '../../shared/plans/plans.ts'
import { recordEvent } from '../audit.ts'
import type { Db, Pool } from '../db.ts'
import type { Role } from '../users.ts'

const NO_STORE = 'private, no-store'

export function proSql(db: Db) {
  return db`(u.role = 'admin' or u.pro_granted_at is not null or ${paidSql(db)})`
}

function paidSql(db: Db) {
  return db`exists (select 1 from subscriptions s where s.user_id = u.id
    and s.status = any(${[...PRO_STATUSES]}::text[]))`
}

export function planFor(pro: boolean): Plan {
  return pro ? 'pro' : 'free'
}

export function planSourceFor(role: Role, given: boolean, paid = false): PlanSource {
  if (role === 'admin') return 'admin'
  if (paid) return 'paid'
  return given ? 'given' : 'free'
}

export function requirePro(session: { plan: Plan }, feature: ProFeature): Response | null {
  if (canUse(session.plan, feature)) return null
  return Response.json({ error: 'pro', feature }, { status: 403, headers: { 'cache-control': NO_STORE } })
}

export function requireProText(session: { plan: Plan }, feature: ProFeature): Response | null {
  if (canUse(session.plan, feature)) return null
  return new Response(proNotice(feature).heading, {
    status: 403,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': NO_STORE },
  })
}

export type GrantResult = { changed: boolean } | 'admin' | 'not_found'

interface GrantAudit {
  by: number | null
  via: 'users page' | 'users script'
  ip?: string | null
  osUser?: string
}

function changeGrant(pool: Pool, userId: number, give: boolean, audit: GrantAudit): Promise<GrantResult> {
  return pool.begin(async (tx): Promise<GrantResult> => {
    const [row] = await tx<{ username: string; role: Role; given: boolean }[]>`
      select username, role, pro_granted_at is not null as given from users where id = ${userId} for update`
    if (!row) return 'not_found'
    if (row.role === 'admin') return 'admin'
    if (row.given === give) return { changed: false }
    if (give) await tx`update users set pro_granted_at = now(), pro_granted_by = ${audit.by} where id = ${userId}`
    else await tx`update users set pro_granted_at = null, pro_granted_by = null where id = ${userId}`
    const { by, via, osUser } = audit
    await recordEvent(tx, give ? 'plan.granted' : 'plan.revoked', {
      userId,
      ip: audit.ip ?? null,
      detail: { user: row.username, by, via, ...(osUser ? { osUser } : {}) },
    })
    return { changed: true }
  })
}

export function grantPro(pool: Pool, userId: number, audit: GrantAudit): Promise<GrantResult> {
  return changeGrant(pool, userId, true, audit)
}

export function revokePro(pool: Pool, userId: number, audit: GrantAudit): Promise<GrantResult> {
  return changeGrant(pool, userId, false, audit)
}

export interface PlanUsage {
  source: PlanSource
  books: number
  highlights: number
}

export async function planUsage(db: Db, userId: number): Promise<PlanUsage | null> {
  const [row] = await db<{ role: Role; given: boolean; paid: boolean; books: string; highlights: string }[]>`
    select u.role, u.pro_granted_at is not null as given, ${paidSql(db)} as paid,
      (select count(*) from user_books b where b.user_id = u.id and b.article_url is null) as books,
      (select count(*) from highlights h where h.user_id = u.id) as highlights
    from users u where u.id = ${userId}`
  if (!row) return null
  return {
    source: planSourceFor(row.role, row.given, row.paid),
    books: Number(row.books),
    highlights: Number(row.highlights),
  }
}
