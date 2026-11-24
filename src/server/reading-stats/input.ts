import { isBookSlug } from '../../shared/content/book-slug.ts'
import { isObject, only } from '../../shared/lib/json-shape.ts'
import { isTimeZone } from '../../shared/reading-stats/days.ts'
import { isGoalChoice } from '../../shared/reading-stats/goals.ts'

export interface GoalInput {
  minutes: number
  zone: string
}

export interface FinishedInput {
  book: string
  finished: boolean
}

const exactly = (value: Record<string, unknown>, keys: readonly string[]) =>
  only(value, keys) && keys.every((k) => k in value)

export function parseGoal(value: unknown): GoalInput | null {
  if (!isObject(value) || !exactly(value, ['minutes', 'zone'])) return null
  const { minutes, zone } = value
  if (!isGoalChoice(minutes) || !isTimeZone(zone)) return null
  return { minutes, zone }
}

export function parseFinished(value: unknown): FinishedInput | null {
  if (!isObject(value) || !exactly(value, ['book', 'finished'])) return null
  const { book, finished } = value
  if (!isBookSlug(book) || typeof finished !== 'boolean') return null
  return { book, finished }
}
