import { cn } from '~/client/lib/cn'
import type { DayStats } from '~/shared/reading-stats/contract'
import { dayLabel, dayName } from './stats-copy'

export function WeekBars({ week, today, goalMinutes }: { week: DayStats[]; today: string; goalMinutes: number }) {
  const totalOf = (d: DayStats) => d.readingSeconds + d.listeningSeconds
  const scale = Math.max(goalMinutes * 60, ...week.map(totalOf), 1)
  const goalAt = Math.min(100, ((goalMinutes * 60) / scale) * 100)
  return (
    <ol data-testid="stats-week" className="grid grid-cols-7 gap-1.5 sm:gap-3">
      {week.map((d) => {
        const seconds = totalOf(d)
        return (
          <li key={d.day} data-testid="stats-day" data-key={d.day} className="min-w-0">
            <span className="sr-only">{dayName(d.day, seconds, d.met)}</span>
            <div aria-hidden className="flex flex-col items-center gap-2">
              <div className="relative h-32 w-full max-w-10 rounded-lg bg-inset">
                <div
                  className={cn(
                    'absolute inset-x-0 bottom-0 rounded-lg',
                    d.met ? 'bg-accent-fill' : 'bg-subtle/45',
                    seconds > 0 && 'min-h-1',
                  )}
                  style={{ height: `${(seconds / scale) * 100}%` }}
                />
                <div
                  className="absolute inset-x-0 border-t-2 border-dashed border-ink/40"
                  style={{ bottom: `${goalAt}%` }}
                />
              </div>
              <span className={cn('text-[12.5px]', d.day === today ? 'font-semibold text-ink' : 'text-muted')}>
                {dayLabel(d.day, today)}
              </span>
              <span className="text-[13px] font-medium text-ink tabular">{Math.floor(seconds / 60)}</span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
