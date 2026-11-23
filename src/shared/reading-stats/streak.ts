import { addDays, type Day } from './days.ts'
import { type GoalChange, goalOn } from './goals.ts'

export interface Streaks {
  current: number
  best: number
  todayMet: boolean
  toKeepSeconds: number
}

export function streaks(totals: ReadonlyMap<Day, number>, history: readonly GoalChange[], today: Day): Streaks {
  const met = (day: Day) => (totals.get(day) ?? 0) >= goalOn(day, history) * 60
  const todayMet = met(today)
  let current = 0
  for (let day = todayMet ? today : addDays(today, -1); met(day); day = addDays(day, -1)) current++
  let best = 0
  let run = 0
  let previous: Day | null = null
  for (const day of [...totals.keys()].filter((d) => d <= today).sort()) {
    if (!met(day)) {
      run = 0
    } else {
      run = previous !== null && addDays(previous, 1) === day && run > 0 ? run + 1 : 1
      best = Math.max(best, run)
    }
    previous = day
  }
  const todaySeconds = totals.get(today) ?? 0
  return {
    current,
    best: Math.max(best, current),
    todayMet,
    toKeepSeconds: Math.max(0, goalOn(today, history) * 60 - todaySeconds),
  }
}
