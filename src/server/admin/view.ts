import '@tanstack/react-start/server-only'
import type { AdminUserView } from '~/shared/admin/users'
import { planSourceFor } from '../plans/plan.ts'
import type { AdminUserRow } from './store.ts'

export function toAdminUserView(row: AdminUserRow): AdminUserView {
  const planSource = planSourceFor(row.role, row.given, row.paid !== null)
  return {
    username: row.username,
    role: row.role,
    status: row.disabledAt ? 'disabled' : row.lockedUntil ? 'locked' : 'active',
    lockedUntil: row.lockedUntil?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    lastActiveAt: row.lastActiveAt?.toISOString() ?? null,
    sessions: row.sessions,
    hasKey: row.hasKey,
    email: row.email,
    plan: planSource === 'free' ? 'free' : 'pro',
    planSource,
    paid: planSource === 'paid' ? row.paid : null,
    you: row.you,
  }
}

export const toAdminUserViews = (rows: readonly AdminUserRow[]): AdminUserView[] => rows.map(toAdminUserView)
