import type { Day } from './days.ts'

export const GOAL_CHOICES = [5, 10, 15, 20, 30, 45, 60, 90, 120] as const

export const DEFAULT_GOAL_MINUTES = 15

export const isGoalChoice = (value: unknown): value is (typeof GOAL_CHOICES)[number] =>
  typeof value === 'number' && (GOAL_CHOICES as readonly number[]).includes(value)

export interface GoalChange {
  fromDay: Day
  minutes: number
}

export function goalOn(day: Day, history: readonly GoalChange[]): number {
  let best: GoalChange | null = null
  for (const change of history) {
    if (change.fromDay > day) continue
    if (!best || change.fromDay >= best.fromDay) best = change
  }
  return best ? best.minutes : DEFAULT_GOAL_MINUTES
}
