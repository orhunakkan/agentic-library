import { ChevronLeft, ChevronRight, Share2 } from 'lucide-react'
import { AppLink } from '~/client/components/AppLink'
import { cn } from '~/client/lib/cn'
import type { NavTarget } from '~/shared/content/navigation'
import type { ReaderView } from '~/shared/content/reader-view'
import { type Direction, type Turn, turnFor } from './Page'

function navLabel(target: NavTarget, direction: Direction): string {
  if (target.kind === 'start') return 'Start of book'
  if (target.kind === 'end') return 'End of book'
  if (target.kind === 'chapter') return target.title
  return direction === 'prev' ? 'Previous page' : 'Next page'
}

export function BottomBar({
  view,
  goTo,
  onShare,
}: {
  view: ReaderView
  goTo: (t: NavTarget, d: Turn) => void
  onShare: () => void
}) {
  const { prev, next, status, progress, dots } = view.nav
  const ratio = progress.position / progress.total

  return (
    <nav
      aria-label="Page navigation"
      data-chrome
      className="fixed right-0 left-0 z-40 h-[60px] border-t border-r-line bg-r-page/92 backdrop-blur-[14px] min-[900px]:rail-shown:left-[288px] min-[900px]:ask-open:right-[380px]"
      style={{ bottom: 'var(--player-h)' }}
    >
      <div
        role="progressbar"
        data-testid="reader-progress"
        aria-label="Progress in book"
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.position}
        className="absolute inset-x-0 -top-px h-[3px] bg-r-line/60"
      >
        <div
          className="h-full bg-r-accent transition-[width] duration-500 ease-out"
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
      <div className="mx-auto flex h-full max-w-[1100px] items-center justify-between gap-2 px-3 md:px-6">
        <PageLink target={prev} direction="prev" goTo={goTo} />
        <div className="flex min-w-0 items-center gap-4">
          <p
            aria-live="polite"
            data-testid="reader-page-label"
            className="text-[13px] whitespace-nowrap text-r-muted tabular"
          >
            <span className="sr-only">{view.chapterTitle}. </span>
            Chapter {status.chapterNumber} · Page {status.page} of {status.pageCount}
          </p>
          {dots.length > 1 && dots.length <= 24 && (
            <ol className="hidden items-center gap-1.5 sm:flex" aria-label="Pages in this chapter">
              {dots.map((dot, i) => (
                <li key={dot.href}>
                  <AppLink
                    href={dot.href}
                    data-testid="reader-page-dot"
                    data-key={dot.href}
                    preload={false}
                    aria-label={`Page ${i + 1}`}
                    aria-current={dot.current ? 'page' : undefined}
                    className={cn(
                      'block h-1.5 rounded-full transition-all',
                      dot.current ? 'w-[18px] bg-r-accent' : 'w-1.5 bg-r-line hover:bg-r-muted',
                    )}
                  />
                </li>
              ))}
            </ol>
          )}
          <button
            type="button"
            data-testid="reader-share"
            onClick={onShare}
            className="hidden items-center gap-1.5 rounded-full px-2 py-1.5 text-[13px] text-r-muted transition hover:text-r-ink min-[900px]:inline-flex"
          >
            <Share2 className="size-4" aria-hidden />
            Share
          </button>
        </div>
        <PageLink target={next} direction="next" goTo={goTo} />
      </div>
    </nav>
  )
}

function PageLink({
  target,
  direction,
  goTo,
}: {
  target: NavTarget
  direction: Direction
  goTo: (t: NavTarget, d: Turn) => void
}) {
  const content = (
    <>
      {direction === 'prev' && <ChevronLeft className="size-4 shrink-0" aria-hidden />}
      <span className="sr-only truncate sm:not-sr-only">{navLabel(target, direction)}</span>
      {direction === 'next' && <ChevronRight className="size-4 shrink-0" aria-hidden />}
    </>
  )
  const testId = direction === 'prev' ? 'reader-previous-page' : 'reader-next-page'
  const cls = cn(
    'flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-full px-2 text-[13.5px] transition sm:max-w-[30%]',
    direction === 'next' ? 'sm:justify-end' : 'sm:justify-start',
  )
  if (target.kind === 'start' || target.kind === 'end') {
    return (
      <span data-testid={testId} className={cn(cls, 'cursor-default text-r-muted opacity-40')} aria-disabled="true">
        {content}
      </span>
    )
  }
  return (
    <AppLink
      href={target.href}
      data-testid={testId}
      preload={false}
      rel={direction}
      onClick={(e) => {
        if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
          e.preventDefault()
          goTo(target, turnFor(direction))
        }
      }}
      className={cn(cls, 'text-r-muted hover:text-r-ink')}
    >
      {content}
    </AppLink>
  )
}

export function SideArrows({ view, turnPage }: { view: ReaderView; turnPage: (direction: Direction) => void }) {
  const cls =
    'fixed top-1/2 z-30 hidden size-14 -translate-y-1/2 place-items-center rounded-full border border-r-line bg-r-paper/70 text-r-ink shadow-sm backdrop-blur-md transition hover:border-r-accent/50 hover:bg-r-paper disabled:pointer-events-none disabled:opacity-0 min-[1280px]:grid min-[1000px]:rail-hidden:grid min-[1000px]:fullscreen:grid min-[900px]:ask-open:hidden! scroll-mode:hidden!'
  const { prev, next } = view.nav
  return (
    <>
      <button
        type="button"
        data-testid="reader-previous-arrow"
        aria-label={navLabel(prev, 'prev')}
        disabled={prev.kind === 'start'}
        onClick={() => turnPage('prev')}
        className={cn(cls, 'left-[calc(288px+20px)] rail-hidden:left-5 fullscreen:left-5')}
      >
        <ChevronLeft className="size-6" />
      </button>
      <button
        type="button"
        data-testid="reader-next-arrow"
        aria-label={navLabel(next, 'next')}
        disabled={next.kind === 'end'}
        onClick={() => turnPage('next')}
        className={cn(cls, 'right-5')}
      >
        <ChevronRight className="size-6" />
      </button>
    </>
  )
}
