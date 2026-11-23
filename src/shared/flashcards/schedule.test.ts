import { describe, expect, it } from 'vitest'
import { INTERVAL_DAYS, nextReview } from './schedule'

const now = new Date('2026-11-09T10:00:00Z')
const days = (d: Date) => (d.getTime() - now.getTime()) / 86_400_000

describe('nextReview', () => {
  it('moves a card up a box at a time, 1, 3, 7, 16 and 35 days on', () => {
    const steps = [0, 1, 2, 3, 4].map((box) => nextReview(box, 'good', now))
    expect(steps.map((s) => s.box)).toEqual([1, 2, 3, 4, 5])
    expect(steps.map((s) => days(s.dueAt))).toEqual([1, 3, 7, 16, 35])
    expect(INTERVAL_DAYS).toEqual([1, 3, 7, 16, 35])
  })

  it('keeps a card in box 5 at 35 days', () => {
    const top = nextReview(5, 'good', now)
    expect([top.box, days(top.dueAt)]).toEqual([5, 35])
  })

  it('puts a card back in box 0, due now, on Again from any box', () => {
    for (const box of [0, 1, 3, 5]) expect(nextReview(box, 'again', now)).toEqual({ box: 0, dueAt: now })
  })
})
