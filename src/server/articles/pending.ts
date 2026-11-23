import '@tanstack/react-start/server-only'
import { randomUUID } from 'node:crypto'

export const PENDING_TTL_MS = 30 * 60_000
export const PENDING_PER_USER = 10

export interface PendingFetch {
  userId: number
  url: string
  pictures: ReadonlySet<string>
  at: number
}

const pending = new Map<string, PendingFetch>()

export function resetPending(): void {
  pending.clear()
}

function sweep(now: number): void {
  for (const [id, entry] of pending) if (now - entry.at >= PENDING_TTL_MS) pending.delete(id)
}

export function hold(userId: number, url: string, pictures: readonly string[], now = Date.now()): string {
  sweep(now)
  const id = randomUUID()
  pending.set(id, { userId, url, pictures: new Set(pictures), at: now })
  const mine = [...pending].filter(([, entry]) => entry.userId === userId)
  for (const [old] of mine.slice(0, Math.max(0, mine.length - PENDING_PER_USER))) pending.delete(old)
  return id
}

export function find(userId: number, id: string, now = Date.now()): PendingFetch | null {
  const entry = pending.get(id)
  if (!entry || entry.userId !== userId) return null
  if (now - entry.at >= PENDING_TTL_MS) {
    pending.delete(id)
    return null
  }
  return entry
}

export function take(userId: number, id: string, now = Date.now()): PendingFetch | null {
  const entry = find(userId, id, now)
  if (entry) pending.delete(id)
  return entry
}

export function pictureAllowed(userId: number, id: string, url: string, now = Date.now()): boolean {
  return find(userId, id, now)?.pictures.has(url) ?? false
}
