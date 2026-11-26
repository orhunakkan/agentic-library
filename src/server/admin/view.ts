import '@tanstack/react-start/server-only'
import type { AdminUserView } from '~/shared/admin/users'
import type { AdminUserRow } from './store.ts'

export function toAdminUserView(row: AdminUserRow): AdminUserView {
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
    you: row.you,
  }
}

export const toAdminUserViews = (rows: readonly AdminUserRow[]): AdminUserView[] => rows.map(toAdminUserView)
