import { type Day, weekdayOf } from '~/shared/reading-stats/days'
import type { FinishedProblem, GoalProblem } from './stats-client'

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`
const minutesOf = (seconds: number) => Math.floor(seconds / 60)

export function formatDuration(seconds: number): string {
  const minutes = minutesOf(seconds)
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest} min`
  return rest === 0 ? `${hours.toLocaleString('en-GB')} h` : `${hours.toLocaleString('en-GB')} h ${rest} min`
}

export function todayLine(todaySeconds: number, goalMinutes: number, met: boolean): string {
  const minutes = minutesOf(todaySeconds)
  return met ? `${plural(minutes, 'minute', 'minutes')} today · goal met` : `${minutes} of ${goalMinutes} minutes today`
}

export function streakLine(current: number, todayMet: boolean, toKeepSeconds: number): string {
  if (current === 0) return 'No streak yet. Meet your goal today to start one.'
  const streak = `${current.toLocaleString('en-GB')}-day streak`
  if (todayMet) return streak
  return `${streak}. Read ${plural(Math.ceil(toKeepSeconds / 60), 'more minute', 'more minutes')} today to keep it.`
}

export const bestLine = (best: number): string | null => (best >= 1 ? `Best: ${plural(best, 'day', 'days')}` : null)

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const LONG_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export const dayLabel = (day: Day, today: Day): string => (day === today ? 'Today' : (SHORT_DAYS[weekdayOf(day)] ?? ''))

export function dayName(day: Day, seconds: number, met: boolean): string {
  const date = `${LONG_DAYS[weekdayOf(day)]} ${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`
  if (seconds < 60 && !met) return `${date}: no reading`
  return `${date}: ${plural(minutesOf(seconds), 'minute', 'minutes')}, ${met ? 'goal met' : 'goal not met'}`
}

export const TOTAL_LABELS = { week: 'Last 7 days', month: 'This month', year: 'This year', all: 'All time' } as const

export function totalsLine(total: { reading: number; listening: number }): string {
  const reading = `Reading ${formatDuration(total.reading)}`
  return total.listening > 0 ? `${reading} · Listening ${formatDuration(total.listening)}` : reading
}

export function finishedCountLine(count: number): string {
  return count === 0 ? 'No books finished this year yet.' : `${plural(count, 'book', 'books')} finished this year`
}

export function finishedDateLine(iso: string, now = new Date()): string {
  const date = new Date(iso)
  const sameYear = date.getFullYear() === now.getFullYear()
  return `Finished ${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }) })}`
}

export function goalChoiceLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return plural(rest, 'minute', 'minutes')
  const h = plural(hours, 'hour', 'hours')
  return rest === 0 ? h : `${h} ${plural(rest, 'minute', 'minutes')}`
}

export const goalSavedLine = (minutes: number) => `Saved. Your goal is ${goalChoiceLabel(minutes)} a day from today.`

export const finishedToast = (title: string) => `Finished ${title}. It’s in your reading stats.`

export const unfinishedLine = (title: string) => `${title} is no longer marked finished.`

export const GOAL_ERRORS: Record<GoalProblem, string> = {
  invalid: 'That goal isn’t one of the choices.',
  signed_out: 'Sign in again to change your goal.',
  failed: 'Couldn’t save your goal. Try again.',
}

export const FINISHED_ERRORS: Record<FinishedProblem, string> = {
  not_found: 'That book isn’t in your library any more.',
  signed_out: 'Sign in again to change that.',
  invalid: 'Couldn’t change that. Try again.',
  failed: 'Couldn’t change that. Try again.',
}

export const STATS_EMPTY = 'Your reading time shows here once you read or listen to a book while signed in.'
export const STATS_UNAVAILABLE = 'Your stats can’t be loaded right now. Try again in a moment.'
export const STATS_INTRO = 'Time you spend reading and listening while signed in, on every device, by your local day.'

export function cardTodayLine(todaySeconds: number, goalMinutes: number, met: boolean): string {
  const minutes = minutesOf(todaySeconds)
  return met ? `Today: ${minutes} min · goal met` : `Today: ${minutes} of ${goalMinutes} min`
}

export const cardStreakLine = (current: number): string | null =>
  current >= 1 ? `${current.toLocaleString('en-GB')}-day streak` : null
