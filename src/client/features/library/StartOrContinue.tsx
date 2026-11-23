import { BookOpen } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { AppLink } from '~/client/components/AppLink'
import { placeFor, type RecentReading } from '~/client/features/reader/continue-reading'
import { onSynced } from '~/client/features/sync/engine'

export function StartOrContinue({
  slug,
  startHref,
  children,
}: {
  slug: string
  startHref: string
  children?: ReactNode
}) {
  const [place, setPlace] = useState<RecentReading | null>(null)
  useEffect(() => {
    const read = () => {
      const found = placeFor(slug)
      setPlace(found && found.href !== startHref ? found : null)
    }
    read()
    return onSynced((kinds) => {
      if (kinds.includes('reading')) read()
    })
  }, [slug, startHref])

  return (
    <>
      <div className="mt-7 flex flex-wrap gap-3">
        <AppLink
          href={place?.href ?? startHref}
          preload={false}
          data-testid="book-start-reading"
          className="inline-flex h-12 items-center gap-2 rounded-xl bg-accent-fill px-6 text-[15px] font-bold text-on-accent transition hover:-translate-y-0.5 active:scale-[.98]"
        >
          <BookOpen className="size-[18px]" aria-hidden />
          {place ? 'Continue reading' : 'Start reading'}
        </AppLink>
        {children}
      </div>
      {place && (
        <p className="mt-3 text-[14px] text-muted" data-testid="book-reading-place">
          {place.label ?? place.chapterTitle} ·{' '}
          <AppLink
            href={startHref}
            preload={false}
            data-testid="book-start-from-beginning"
            className="font-semibold text-ink underline decoration-line underline-offset-4 transition hover:decoration-accent"
          >
            Start from the beginning
          </AppLink>
        </p>
      )}
    </>
  )
}
