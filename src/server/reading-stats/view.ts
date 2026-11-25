import '@tanstack/react-start/server-only'
import {
  type DayStats,
  type FinishedBook,
  MAX_DAY_SECONDS,
  MAX_FINISHED_SHOWN,
  type ReadingStatsState,
  type ReadingSummaryState,
  type TotalStats,
} from '~/shared/reading-stats/contract'
import { addDays, type Day, dayIn } from '~/shared/reading-stats/days'
import { type GoalChange, goalOn } from '~/shared/reading-stats/goals'
import { streaks } from '~/shared/reading-stats/streak'
import type { DayTotal } from './store.ts'

export interface ResolvedFinished extends Omit<FinishedBook, 'finishedAt'> {
  finishedAt: Date
}

interface Rows {
  today: Day
  zone: string
  totals: readonly DayTotal[]
  history: readonly GoalChange[]
}

function perDay(totals: readonly DayTotal[], today: Day): Map<Day, TotalStats> {
  const days = new Map<Day, TotalStats>()
  for (const row of totals) {
    if (row.day > today) continue
    const day = days.get(row.day) ?? { reading: 0, listening: 0 }
    day[row.kind] += row.seconds
    days.set(row.day, day)
  }
  for (const day of days.values()) {
    day.reading = Math.min(day.reading, MAX_DAY_SECONDS)
    day.listening = Math.min(day.listening, MAX_DAY_SECONDS - day.reading)
  }
  return days
}

function summaryOf({ today, totals, history }: Rows) {
  const days = perDay(totals, today)
  const sums = new Map([...days].map(([day, t]) => [day, t.reading + t.listening]))
  return { days, sums, goalMinutes: goalOn(today, history), ...streaks(sums, history, today) }
}

export function toSummaryState(rows: Rows): Extract<ReadingSummaryState, { state: 'ready' }> {
  const summary = summaryOf(rows)
  return {
    state: 'ready',
    todaySeconds: summary.sums.get(rows.today) ?? 0,
    goalMinutes: summary.goalMinutes,
    current: summary.current,
    todayMet: summary.todayMet,
  }
}

export function toStatsState(
  rows: Rows & { finished: readonly ResolvedFinished[] },
): Extract<ReadingStatsState, { state: 'ready' }> {
  const { today, zone, history } = rows
  const summary = summaryOf(rows)
  const week: DayStats[] = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(today, i - 6)
    const dayTotal = summary.days.get(day) ?? { reading: 0, listening: 0 }
    const goalMinutes = goalOn(day, history)
    return {
      day,
      readingSeconds: dayTotal.reading,
      listeningSeconds: dayTotal.listening,
      goalMinutes,
      met: dayTotal.reading + dayTotal.listening >= goalMinutes * 60,
    }
  })
  const sum = (keep: (day: Day) => boolean): TotalStats => {
    const total = { reading: 0, listening: 0 }
    for (const [day, t] of summary.days) {
      if (!keep(day)) continue
      total.reading += t.reading
      total.listening += t.listening
    }
    return total
  }
  const weekStart = addDays(today, -6)
  const year = today.slice(0, 4)
  return {
    state: 'ready',
    today,
    goalMinutes: summary.goalMinutes,
    todaySeconds: summary.sums.get(today) ?? 0,
    current: summary.current,
    best: summary.best,
    todayMet: summary.todayMet,
    toKeepSeconds: summary.toKeepSeconds,
    week,
    totals: {
      week: sum((day) => day >= weekStart),
      month: sum((day) => day.slice(0, 7) === today.slice(0, 7)),
      year: sum((day) => day.slice(0, 4) === year),
      all: sum(() => true),
    },
    finished: rows.finished
      .slice(0, MAX_FINISHED_SHOWN)
      .map((f) => ({ book: f.book, title: f.title, href: f.href, finishedAt: f.finishedAt.toISOString() })),
    finishedThisYear: rows.finished.filter((f) => dayIn(f.finishedAt, zone).slice(0, 4) === year).length,
    hasAny: summary.days.size > 0 || rows.finished.length > 0,
  }
}
