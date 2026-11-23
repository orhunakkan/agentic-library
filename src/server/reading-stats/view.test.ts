import { describe, expect, it } from 'vitest'
import { MAX_DAY_SECONDS, MAX_FINISHED_SHOWN } from '~/shared/reading-stats/contract'
import { toStatsState, toSummaryState } from './view'

const TODAY = '2026-11-21'
const base = { today: TODAY, zone: 'UTC', history: [] }

describe('toStatsState', () => {
  it('reads a day as at most 24 hours, reading first, and leaves out days after today', () => {
    const stats = toStatsState({
      ...base,
      totals: [
        { day: TODAY, kind: 'reading', seconds: 80_000 },
        { day: TODAY, kind: 'listening', seconds: 20_000 },
        { day: '2026-11-22', kind: 'reading', seconds: 600 },
      ],
      finished: [],
    })
    expect(stats.todaySeconds).toBe(MAX_DAY_SECONDS)
    expect(stats.week.at(-1)).toEqual({
      day: TODAY,
      readingSeconds: 80_000,
      listeningSeconds: MAX_DAY_SECONDS - 80_000,
      goalMinutes: 15,
      met: true,
    })
    expect(stats.totals.all).toEqual({ reading: 80_000, listening: MAX_DAY_SECONDS - 80_000 })
  })

  it('lists at most the newest 100 finished books, and counts this year’s in the zone', () => {
    const finished = Array.from({ length: MAX_FINISHED_SHOWN + 5 }, (_, i) => ({
      book: `book-${i}`,
      title: `Book ${i}`,
      href: `/library/s/book-${i}`,
      finishedAt: new Date(Date.UTC(2026, 10, 20, 12) - i * 3_600_000),
    }))
    finished.push({
      book: 'late',
      title: 'Late',
      href: '/library/s/late',
      finishedAt: new Date('2025-12-31T23:30:00Z'),
    })
    const utc = toStatsState({ ...base, totals: [], finished })
    expect(utc.finished).toHaveLength(MAX_FINISHED_SHOWN)
    expect(utc.finished[0]).toEqual({
      book: 'book-0',
      title: 'Book 0',
      href: '/library/s/book-0',
      finishedAt: '2026-11-20T12:00:00.000Z',
    })
    expect(utc.finishedThisYear).toBe(MAX_FINISHED_SHOWN + 5)
    const east = toStatsState({ ...base, zone: 'Pacific/Kiritimati', totals: [], finished })
    expect(east.finishedThisYear).toBe(MAX_FINISHED_SHOWN + 6)
    expect(east.hasAny).toBe(true)
  })
})

describe('toSummaryState', () => {
  it('agrees with the stats on today, the goal and the streak', () => {
    const rows = {
      ...base,
      history: [{ fromDay: '2026-11-01', minutes: 5 }],
      totals: [
        { day: TODAY, kind: 'reading' as const, seconds: 400 },
        { day: '2026-11-20', kind: 'listening' as const, seconds: 300 },
      ],
    }
    const stats = toStatsState({ ...rows, finished: [] })
    expect(toSummaryState(rows)).toEqual({
      state: 'ready',
      todaySeconds: stats.todaySeconds,
      goalMinutes: 5,
      current: 2,
      todayMet: true,
    })
    expect(stats.current).toBe(2)
  })
})
