import { useRouter } from '@tanstack/react-router'
import { useEffect } from 'react'
import { AccountPage, Notice, Section } from '~/client/features/account/ui'
import type { ReadingStatsState } from '~/shared/reading-stats/contract'
import { FinishedList } from './FinishedList'
import { GoalForm } from './GoalForm'
import { flushReadingTime } from './reading-time'
import {
  bestLine,
  formatDuration,
  STATS_EMPTY,
  STATS_INTRO,
  STATS_UNAVAILABLE,
  streakLine,
  TOTAL_LABELS,
  todayLine,
  totalsLine,
} from './stats-copy'
import { WeekBars } from './WeekBars'

type Ready = Extract<ReadingStatsState, { state: 'ready' }>

export function StatsPage({ data }: { data: Exclude<ReadingStatsState, { state: 'signed_out' }> }) {
  const router = useRouter()
  useEffect(() => {
    void flushReadingTime().then((sent) => {
      if (sent) void router.invalidate()
    })
  }, [router])

  return (
    <AccountPage eyebrow="Account" title="Reading stats" titleTestId="stats-title" lead={STATS_INTRO}>
      {data.state === 'unavailable' ? (
        <Notice kind="error" data-testid="stats-unavailable">
          {STATS_UNAVAILABLE}
        </Notice>
      ) : (
        <ReadyStats data={data} />
      )}
    </AccountPage>
  )
}

function ReadyStats({ data }: { data: Ready }) {
  const goalSeconds = data.goalMinutes * 60
  const best = bestLine(data.best)
  return (
    <>
      <Section id="today" title="Today">
        <p className="font-display text-[22px] font-bold tracking-[-0.02em] text-ink" data-testid="stats-today">
          {todayLine(data.todaySeconds, data.goalMinutes, data.todayMet)}
        </p>
        <meter
          className="mt-3 h-3 w-full"
          data-testid="stats-today-meter"
          aria-label="Today’s minutes against your goal"
          min={0}
          max={goalSeconds}
          value={Math.min(data.todaySeconds, goalSeconds)}
        />
        <p className="mt-4 text-[15px] text-body" data-testid="stats-streak">
          {streakLine(data.current, data.todayMet, data.toKeepSeconds)}
        </p>
        {best && (
          <p className="mt-1 text-[14px] text-muted" data-testid="stats-best-streak">
            {best}
          </p>
        )}
      </Section>

      <Section id="goal" title="Daily goal">
        <GoalForm goalMinutes={data.goalMinutes} />
      </Section>

      {data.hasAny ? (
        <>
          <Section id="week" title="The last 7 days">
            <WeekBars week={data.week} today={data.today} goalMinutes={data.goalMinutes} />
          </Section>
          <Section id="totals" title="Totals">
            <dl className="divide-y divide-line">
              {(['week', 'month', 'year', 'all'] as const).map((key) => {
                const total = data.totals[key]
                return (
                  <div
                    key={key}
                    data-testid="stats-total"
                    data-key={key}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0"
                  >
                    <dt className="text-[14.5px] text-muted">{TOTAL_LABELS[key]}</dt>
                    <dd className="text-right">
                      <span className="block text-[16px] font-semibold text-ink tabular">
                        {formatDuration(total.reading + total.listening)}
                      </span>
                      <span className="block text-[13px] text-muted">{totalsLine(total)}</span>
                    </dd>
                  </div>
                )
              })}
            </dl>
          </Section>
        </>
      ) : (
        <p className="mt-10 text-[15px] leading-relaxed text-muted" data-testid="stats-empty">
          {STATS_EMPTY}
        </p>
      )}

      <Section id="finished" title="Books finished">
        <FinishedList books={data.finished} thisYear={data.finishedThisYear} />
      </Section>
    </>
  )
}
