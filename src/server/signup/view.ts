import '@tanstack/react-start/server-only'
import type { InviteView } from '~/shared/admin/users'
import type { InviteRow } from './store.ts'

export function toInviteView(row: InviteRow): InviteView {
  return {
    id: row.id,
    note: row.note,
    by: row.by,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  }
}
