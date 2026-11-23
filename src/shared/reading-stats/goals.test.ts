import { describe, expect, it } from 'vitest'
import { DEFAULT_GOAL_MINUTES, GOAL_CHOICES, goalOn, isGoalChoice } from './goals'

describe('goalOn', () => {
  it('is the default with no history', () => {
    expect(goalOn('2026-11-21', [])).toBe(DEFAULT_GOAL_MINUTES)
    expect(DEFAULT_GOAL_MINUTES).toBe(15)
  })

  it('applies a change from its day on, never before it', () => {
    const history = [{ fromDay: '2026-11-21', minutes: 30 }]
    expect(goalOn('2026-11-21', history)).toBe(30)
    expect(goalOn('2026-11-25', history)).toBe(30)
    expect(goalOn('2026-11-20', history)).toBe(15)
  })

  it('takes the newest change on or before the day, whatever the order', () => {
    const history = [
      { fromDay: '2026-11-18', minutes: 20 },
      { fromDay: '2026-11-01', minutes: 5 },
      { fromDay: '2026-11-21', minutes: 60 },
    ]
    expect(goalOn('2026-11-10', history)).toBe(5)
    expect(goalOn('2026-11-19', history)).toBe(20)
    expect(goalOn('2026-11-21', history)).toBe(60)
  })

  it('takes the later of two changes on one day', () => {
    const history = [
      { fromDay: '2026-11-21', minutes: 10 },
      { fromDay: '2026-11-21', minutes: 45 },
    ]
    expect(goalOn('2026-11-21', history)).toBe(45)
  })
})

describe('isGoalChoice', () => {
  it('takes only the choices', () => {
    for (const minutes of GOAL_CHOICES) expect(isGoalChoice(minutes)).toBe(true)
    expect(isGoalChoice(25)).toBe(false)
    expect(isGoalChoice(0)).toBe(false)
    expect(isGoalChoice('15')).toBe(false)
  })
})
