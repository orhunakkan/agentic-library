import { Link } from '@tanstack/react-router'
import type { CollectionState } from '~/client/lib/optimistic-collection'

export const TAB_MESSAGE = 'px-2 py-4 text-[14px] leading-relaxed text-r-muted'

export function TabNotice({
  name,
  state,
  offline,
  signInText,
  next,
  onRetry,
}: {
  name: 'bookmarks' | 'highlights'
  state: CollectionState
  offline: boolean
  signInText: string
  next: string
  onRetry: () => void
}) {
  if (offline)
    return (
      <p data-testid={`${name}-offline`} className={TAB_MESSAGE}>
        {name === 'bookmarks' ? 'Bookmarks' : 'Highlights'} show here when you’re back online.
      </p>
    )
  if (state === 'signed_out') {
    return (
      <div className="space-y-3 px-2 py-4 text-[14px] leading-relaxed">
        <p>{signInText}</p>
        <Link
          to="/login"
          data-testid={`${name}-sign-in`}
          search={{ next }}
          className="inline-flex h-11 items-center rounded-xl bg-r-accent px-5 text-[14.5px] font-semibold text-r-paper transition hover:brightness-105"
        >
          Sign in
        </Link>
      </div>
    )
  }
  if (state === 'loading')
    return (
      <p data-testid={`${name}-loading`} className={TAB_MESSAGE}>
        Loading your {name}…
      </p>
    )
  if (state === 'unavailable') {
    return (
      <div className="space-y-3 px-2 py-4 text-[14px]">
        <p data-testid={`${name}-error`}>Your {name} couldn’t be loaded.</p>
        <button
          type="button"
          data-testid={`${name}-retry`}
          onClick={onRetry}
          className="inline-flex h-10 items-center rounded-full border border-r-line px-4 text-[13.5px] font-medium transition hover:border-r-accent/60"
        >
          Retry
        </button>
      </div>
    )
  }
  return null
}
