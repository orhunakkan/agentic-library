const MAX_BOX = 5
export const INTERVAL_DAYS = [1, 3, 7, 16, 35] as const

export type ReviewResult = 'again' | 'good'

const DAY_MS = 24 * 60 * 60 * 1000

export function nextReview(box: number, result: ReviewResult, now: Date): { box: number; dueAt: Date } {
  if (result === 'again') return { box: 0, dueAt: now }
  const next = Math.min(Math.max(Math.trunc(box), 0) + 1, MAX_BOX)
  return { box: next, dueAt: new Date(now.getTime() + (INTERVAL_DAYS[next - 1] as number) * DAY_MS) }
}
