export interface Limit {
  max: number
  windowMs: number
  blockMs: number
}

const MINUTE = 60_000

export const USERNAME_LIMIT: Limit = { max: 5, windowMs: 15 * MINUTE, blockMs: 15 * MINUTE }
export const IP_LIMIT: Limit = { max: 30, windowMs: 15 * MINUTE, blockMs: 15 * MINUTE }
export const API_KEY_LIMIT: Limit = { max: 10, windowMs: 60 * MINUTE, blockMs: 0 }
export const IMPORT_LIMIT: Limit = { max: 10, windowMs: 60 * MINUTE, blockMs: 0 }

export const ASK_LIMIT: Limit = { max: 60, windowMs: 60 * MINUTE, blockMs: 0 }

export const LOOKUP_LIMIT: Limit = { max: 30, windowMs: 60 * MINUTE, blockMs: 0 }

export const WORD_LOOKUP_LIMIT: Limit = { max: 300, windowMs: 60 * MINUTE, blockMs: 0 }

export const EXPORT_LIMIT: Limit = { max: 10, windowMs: 60 * MINUTE, blockMs: 0 }

export const TRANSLATE_LIMIT: Limit = { max: 120, windowMs: 60 * MINUTE, blockMs: 0 }

export const EMAIL_VERIFY_LIMIT: Limit = { max: 5, windowMs: 60 * MINUTE, blockMs: 0 }

export const RESET_ACCOUNT_LIMIT: Limit = { max: 3, windowMs: 60 * MINUTE, blockMs: 0 }

export const RESET_IP_LIMIT: Limit = { max: 20, windowMs: 60 * MINUTE, blockMs: 0 }

export const SIGNUP_IP_LIMIT: Limit = { max: 5, windowMs: 60 * MINUTE, blockMs: 0 }

export const SIGNUP_ADDRESS_LIMIT: Limit = { max: 3, windowMs: 24 * 60 * MINUTE, blockMs: 0 }

export const SIGNUP_DAILY_LIMIT: Limit = { max: 30, windowMs: 24 * 60 * MINUTE, blockMs: 0 }

export const PASSKEY_CHALLENGE_LIMIT: Limit = { max: 30, windowMs: 15 * MINUTE, blockMs: 0 }

export const REPO_ADD_LIMIT: Limit = { max: 30, windowMs: 60 * MINUTE, blockMs: 0 }
export const REPO_REFRESH_LIMIT: Limit = { max: 120, windowMs: 60 * MINUTE, blockMs: 0 }

export const REPO_VIEW_LIMIT: Limit = { max: 600, windowMs: 60 * MINUTE, blockMs: 0 }

export const ARTICLE_FETCH_LIMIT: Limit = { max: 60, windowMs: 60 * MINUTE, blockMs: 0 }
export const ARTICLE_PICTURE_LIMIT: Limit = { max: 1200, windowMs: 60 * MINUTE, blockMs: 0 }
export const ARTICLE_SAVE_LIMIT: Limit = { max: 60, windowMs: 60 * MINUTE, blockMs: 0 }

export { INVITE_MAX } from '../shared/signup/signup.ts'

export function lookback(limit: Limit): number {
  return limit.windowMs + limit.blockMs
}

export function blockedUntil(times: readonly Date[], limit: Limit, now: Date): Date | null {
  const sorted = times.map((t) => t.getTime()).sort((a, b) => a - b)
  let until = Number.NEGATIVE_INFINITY
  for (let i = limit.max - 1; i < sorted.length; i++) {
    const last = sorted[i] as number
    const first = sorted[i - (limit.max - 1)] as number
    if (last - first <= limit.windowMs) until = Math.max(until, last + limit.blockMs)
  }
  return until > now.getTime() ? new Date(until) : null
}

export function overLimit(times: readonly Date[], limit: Limit, now: Date): boolean {
  return nextAllowedAt(times, limit, now) !== null
}

export function nextAllowedAt(times: readonly Date[], limit: Limit, now: Date): Date | null {
  const since = now.getTime() - limit.windowMs
  const inside = times
    .map((t) => t.getTime())
    .filter((t) => t > since)
    .sort((a, b) => a - b)
  if (inside.length < limit.max) return null
  return new Date((inside[inside.length - limit.max] as number) + limit.windowMs)
}

export const SPEECH_LIMIT: Limit = { max: 150_000, windowMs: 60 * MINUTE, blockMs: 0 }

export function charactersRetryAt(
  minutes: readonly { minute: Date; characters: number }[],
  adding: number,
  limit: Limit,
  now: Date,
): Date | null {
  const inside = minutes
    .filter((m) => m.minute.getTime() + MINUTE > now.getTime() - limit.windowMs)
    .sort((a, b) => a.minute.getTime() - b.minute.getTime())
  let total = inside.reduce((n, m) => n + m.characters, 0)
  if (total + adding <= limit.max) return null
  for (const m of inside) {
    total -= m.characters
    if (total + adding <= limit.max) return new Date(m.minute.getTime() + MINUTE + limit.windowMs)
  }
  return new Date(now.getTime() + limit.windowMs)
}
