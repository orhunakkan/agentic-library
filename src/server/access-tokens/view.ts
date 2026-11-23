import '@tanstack/react-start/server-only'
import type { AccessTokenRow } from './store.ts'

export interface AccessTokenView {
  id: string
  name: string
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string
  current: boolean
}

export function toAccessTokenView(row: AccessTokenRow, currentId: string | null = null): AccessTokenView {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt.toISOString(),
    current: row.id === currentId,
  }
}
