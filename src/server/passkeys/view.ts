import '@tanstack/react-start/server-only'
import type { PasskeyView } from '../../shared/passkeys/passkeys.ts'
import type { PasskeyRow } from './store.ts'

export function toPasskeyView(row: PasskeyRow): PasskeyView {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    backedUp: row.backedUp,
  }
}
