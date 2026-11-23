import '@tanstack/react-start/server-only'
import { ARTICLE_FETCH_LIMIT, ARTICLE_PICTURE_LIMIT, type Limit, nextAllowedAt } from '../rate-limit.ts'

const READERS_MAX = 10_000
export const IN_FLIGHT_MAX = { page: 4, picture: 8 } as const
export type FetchKind = keyof typeof IN_FLIGHT_MAX

const LIMITS: Record<FetchKind, Limit> = { page: ARTICLE_FETCH_LIMIT, picture: ARTICLE_PICTURE_LIMIT }
const counts: Record<FetchKind, Map<number, number[]>> = { page: new Map(), picture: new Map() }
const inFlight: Record<FetchKind, number> = { page: 0, picture: 0 }

export function resetPacing(): void {
  counts.page.clear()
  counts.picture.clear()
  inFlight.page = 0
  inFlight.picture = 0
}

export function takeFetch(kind: FetchKind, userId: number, now = Date.now()): Date | null {
  const limit = LIMITS[kind]
  const readers = counts[kind]
  const recent = (readers.get(userId) ?? []).filter((t) => t > now - limit.windowMs)
  const retryAt = nextAllowedAt(
    recent.map((t) => new Date(t)),
    limit,
    new Date(now),
  )
  if (!retryAt) recent.push(now)
  readers.delete(userId)
  readers.set(userId, recent)
  while (readers.size > READERS_MAX) readers.delete(readers.keys().next().value as number)
  return retryAt
}

export function enter(kind: FetchKind): (() => void) | null {
  if (inFlight[kind] >= IN_FLIGHT_MAX[kind]) return null
  inFlight[kind]++
  let released = false
  return () => {
    if (released) return
    released = true
    inFlight[kind]--
  }
}
