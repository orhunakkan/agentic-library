import { Bookmark } from 'lucide-react'
import { cn } from '~/client/lib/cn'
import type { BookmarksState } from './use-bookmarks'

const TITLE: Partial<Record<BookmarksState, string>> = {
  loading: 'Loading your bookmarks…',
  unavailable: 'Your bookmarks couldn’t be loaded',
}

export function BookmarkRibbon({
  pressed,
  state,
  onToggle,
}: {
  pressed: boolean
  state: BookmarksState
  onToggle: () => void
}) {
  const title = TITLE[state] ?? (pressed ? 'Remove bookmark' : 'Bookmark this page')
  return (
    <button
      type="button"
      data-testid="bookmark-toggle"
      aria-pressed={pressed}
      aria-label="Bookmark this page"
      title={title}
      disabled={state === 'loading' || state === 'unavailable'}
      onClick={onToggle}
      className={cn(
        'absolute top-0 right-1 z-10 grid size-11 place-items-center rounded-full font-sans transition select-none embed:hidden disabled:cursor-default disabled:opacity-50 sm:right-4 md:right-8',
        pressed ? 'text-r-accent' : 'text-r-muted hover:text-r-ink',
      )}
    >
      <Bookmark className={cn('size-5', pressed && 'fill-current')} aria-hidden />
    </button>
  )
}
