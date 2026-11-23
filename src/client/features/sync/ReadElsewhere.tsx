import { ArrowRight, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { AppLink } from '~/client/components/AppLink'
import { visitOf } from '~/client/features/reader/continue-reading'
import { getReadingPlace } from '~/server/account-functions'
import type { ReaderView } from '~/shared/content/reader-view'
import type { ReadingPlace } from '~/shared/sync/sync'
import { offerFor, offerText } from './offer'

const AWAY_MS = 60_000

const dismissed = new Map<string, number>()

interface Shown {
  place: ReadingPlace
  path: string
}

export function ReadElsewhere({
  view,
  signedIn,
  embedded,
}: {
  view: ReaderView
  signedIn: boolean
  embedded: boolean
}) {
  const [shown, setShown] = useState<Shown | null>(null)
  const path = useRef(view.canonicalPath)
  path.current = view.canonicalPath
  const book = view.book.slug

  useEffect(() => {
    if (!signedIn || embedded || document.documentElement.dataset.embed === 'on') {
      setShown(null)
      return
    }
    let live = true
    const ask = (baseline: () => number) => {
      const askedOn = path.current
      getReadingPlace({ data: { book } })
        .then((answer) => {
          if (!live || answer.state !== 'ready' || path.current !== askedOn) return
          const place = offerFor({
            account: answer.place,
            currentHref: askedOn,
            baseline: baseline(),
            dismissedAt: dismissed.get(book) ?? 0,
          })
          if (place) setShown({ place, path: askedOn })
        })
        .catch(() => {})
    }
    ask(() => visitOf(book)?.before ?? 0)
    let hiddenAt: number | null = null
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now()
        return
      }
      const away = hiddenAt !== null && Date.now() - hiddenAt >= AWAY_MS
      hiddenAt = null
      if (away) ask(() => visitOf(book)?.viewedAt ?? 0)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      live = false
      setShown(null)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [book, signedIn, embedded])

  useEffect(() => {
    setShown((current) => (current && current.path !== view.canonicalPath ? null : current))
  }, [view.canonicalPath])

  const visible = shown !== null && shown.path === view.canonicalPath ? shown.place : null
  const dismiss = () => {
    if (visible) dismissed.set(book, visible.at)
    setShown(null)
  }

  return (
    <div className={visible ? 'px-5 pt-4 sm:px-10 md:px-6 md:pt-6 min-[900px]:clear-right' : undefined}>
      <div
        className={
          visible
            ? 'mx-auto flex max-w-(--reader-measure) flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-r-line bg-r-paper py-2 pr-2 pl-4 font-sans text-r-ink shadow-sm'
            : undefined
        }
      >
        <p
          role="status"
          data-testid="read-elsewhere-status"
          className={visible ? 'min-w-[12rem] flex-1 py-1.5 text-[14.5px] leading-snug' : 'sr-only'}
        >
          {visible ? offerText(visible, Date.now()) : ''}
        </p>
        {visible && (
          <div className="flex items-center gap-1">
            <AppLink
              href={visible.href}
              preload={false}
              onClick={() => setShown(null)}
              data-testid="read-elsewhere-go"
              className="inline-flex h-11 items-center gap-1.5 rounded-full bg-r-accent px-4 text-[14.5px] font-semibold text-r-paper transition hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-r-accent"
            >
              Go there
              <ArrowRight className="size-4" aria-hidden />
            </AppLink>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={dismiss}
              data-testid="read-elsewhere-dismiss"
              className="grid size-11 place-items-center rounded-full text-r-muted transition hover:bg-r-line/50 hover:text-r-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-r-accent"
            >
              <X className="size-[18px]" aria-hidden />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
