import { Link } from '@tanstack/react-router'
import { ChartNoAxesColumn } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getReadingSummary } from '~/server/account-functions'
import type { ReadingSummaryState } from '~/shared/reading-stats/contract'
import { flushReadingTime } from './reading-time'
import { cardStreakLine, cardTodayLine } from './stats-copy'

type Summary = Extract<ReadingSummaryState, { state: 'ready' }>

export function LibraryStatsCard() {
  const [summary, setSummary] = useState<Summary | null>(null)
  useEffect(() => {
    let live = true
    void (async () => {
      await flushReadingTime().catch(() => false)
      const state = await getReadingSummary().catch(() => null)
      if (live && state?.state === 'ready') setSummary(state)
    })()
    return () => {
      live = false
    }
  }, [])
  if (!summary) return null
  const streak = cardStreakLine(summary.current)
  return (
    <Link
      to="/account/stats"
      data-testid="library-stats"
      className="flex min-w-0 flex-[1_1_240px] flex-col justify-between gap-3 rounded-[22px] border border-line bg-surface p-6 transition hover:border-accent-line"
    >
      <h2 className="eyebrow flex items-center gap-2 text-accent">
        <ChartNoAxesColumn className="size-4" aria-hidden />
        Your reading
      </h2>
      <div>
        <p className="font-display text-[20px] font-bold tracking-[-0.02em] text-ink" data-testid="library-stats-today">
          {cardTodayLine(summary.todaySeconds, summary.goalMinutes, summary.todayMet)}
        </p>
        {streak && (
          <p className="mt-1 text-[14.5px] text-muted" data-testid="library-stats-streak">
            {streak}
          </p>
        )}
      </div>
    </Link>
  )
}
