import { describe, expect, it } from 'vitest'
import { streaks } from './streak'

const TODAY = '2026-11-21'
const GOAL = 15 * 60
const days = (entries: Record<string, number>) => new Map(Object.entries(entries))

describe('streaks', () => {
  it('are 0 with no days, and today needs the whole goal', () => {
    expect(streaks(new Map(), [], TODAY)).toEqual({ current: 0, best: 0, todayMet: false, toKeepSeconds: GOAL })
  })

  it('count today once it is met', () => {
    expect(streaks(days({ [TODAY]: GOAL }), [], TODAY)).toEqual({
      current: 1,
      best: 1,
      todayMet: true,
      toKeepSeconds: 0,
    })
  })

  it('keep yesterday’s run while today is still open', () => {
    const result = streaks(days({ '2026-11-19': GOAL, '2026-11-20': GOAL, [TODAY]: 300 }), [], TODAY)
    expect(result).toEqual({ current: 2, best: 2, todayMet: false, toKeepSeconds: GOAL - 300 })
  })

  it('are 0 when yesterday wasn’t met and today isn’t yet', () => {
    expect(streaks(days({ '2026-11-19': GOAL, '2026-11-20': 60 }), [], TODAY).current).toBe(0)
  })

  it('stop at a gap', () => {
    const result = streaks(
      days({ '2026-11-17': GOAL, '2026-11-18': GOAL, '2026-11-20': GOAL, [TODAY]: GOAL }),
      [],
      TODAY,
    )
    expect(result.current).toBe(2)
    expect(result.best).toBe(2)
  })

  it('don’t break yesterday’s run when the goal is raised today', () => {
    const history = [{ fromDay: TODAY, minutes: 60 }]
    const result = streaks(days({ '2026-11-19': GOAL, '2026-11-20': GOAL, [TODAY]: GOAL }), history, TODAY)
    expect(result).toEqual({ current: 2, best: 2, todayMet: false, toKeepSeconds: 45 * 60 })
  })

  it('keep the best run apart from the current one', () => {
    const result = streaks(
      days({
        '2026-10-01': GOAL,
        '2026-10-02': GOAL,
        '2026-10-03': GOAL,
        '2026-10-04': 10,
        '2026-10-05': GOAL,
        [TODAY]: GOAL,
      }),
      [],
      TODAY,
    )
    expect(result.current).toBe(1)
    expect(result.best).toBe(3)
  })

  it('count exactly the goal, and not one second under it', () => {
    expect(streaks(days({ [TODAY]: GOAL }), [], TODAY).todayMet).toBe(true)
    expect(streaks(days({ [TODAY]: GOAL - 1 }), [], TODAY)).toMatchObject({ todayMet: false, toKeepSeconds: 1 })
  })

  it('take a day’s reading and listening together, as its total', () => {
    expect(streaks(days({ [TODAY]: 600 + 300 }), [], TODAY).todayMet).toBe(true)
  })

  it('leave out a day after today', () => {
    expect(streaks(days({ '2026-11-22': GOAL }), [], TODAY)).toMatchObject({ current: 0, best: 0 })
  })
})
