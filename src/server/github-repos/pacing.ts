import '@tanstack/react-start/server-only'
import { nextAllowedAt, REPO_VIEW_LIMIT } from '../rate-limit.ts'

const READERS_MAX = 10_000

const views = new Map<number, number[]>()

export function resetPacing(): void {
  views.clear()
}

export function takeView(userId: number, now = Date.now()): Date | null {
  const since = now - REPO_VIEW_LIMIT.windowMs
  const recent = (views.get(userId) ?? []).filter((t) => t > since)
  const retryAt = nextAllowedAt(
    recent.map((t) => new Date(t)),
    REPO_VIEW_LIMIT,
    new Date(now),
  )
  if (retryAt) {
    views.set(userId, recent)
    return retryAt
  }
  recent.push(now)
  views.delete(userId)
  views.set(userId, recent)
  while (views.size > READERS_MAX) views.delete(views.keys().next().value as number)
  return null
}
