import type { Day } from './days.ts'

export const TICK_MS = 5_000
export const IDLE_MS = 180_000
export const MAX_READING_STEP_MS = 10_000
export const MAX_LISTENING_STEP_MS = 300_000
export const MAX_SESSION_SECONDS = 14_400
export const MAX_SESSIONS_PER_DAY = 200
export const DAY_WINDOW = { before: 7, after: 1 } as const
export const MAX_DAY_SECONDS = 86_400
export const MAX_FINISHED_SHOWN = 100

export interface DayStats {
  day: Day
  readingSeconds: number
  listeningSeconds: number
  goalMinutes: number
  met: boolean
}

export interface TotalStats {
  reading: number
  listening: number
}

export interface FinishedBook {
  book: string
  title: string
  href: string
  finishedAt: string
}

export type ReadingStatsState =
  | { state: 'signed_out' }
  | { state: 'unavailable' }
  | {
      state: 'ready'
      today: Day
      goalMinutes: number
      todaySeconds: number
      current: number
      best: number
      todayMet: boolean
      toKeepSeconds: number
      week: DayStats[]
      totals: { week: TotalStats; month: TotalStats; year: TotalStats; all: TotalStats }
      finished: FinishedBook[]
      finishedThisYear: number
      hasAny: boolean
    }

export type ReadingSummaryState =
  | { state: 'signed_out' }
  | { state: 'unavailable' }
  | { state: 'ready'; todaySeconds: number; goalMinutes: number; current: number; todayMet: boolean }

export type GoalErrorCode = 'invalid' | 'signed_out' | 'failed'
export type FinishedErrorCode = 'invalid' | 'signed_out' | 'not_found' | 'failed'
