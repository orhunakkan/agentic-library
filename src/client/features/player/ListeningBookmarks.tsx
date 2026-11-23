import { Link, useRouterState } from '@tanstack/react-router'
import { X } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import {
  type AudioBookmarkItem,
  type AudioBookmarksApi,
  useAudioBookmarks,
} from '~/client/features/bookmarks/use-audio-bookmarks'
import { formatClock } from '~/client/lib/format'
import { bookmarkKind } from './now-playing'
import { usePlayer } from './PlayerProvider'

const SECTION_MARGIN = 24
const SLIDE_MS = 450

export function momentLabel(item: AudioBookmarkItem): string | null {
  if (item.kind === 'voice') return item.place?.label ?? null
  return item.episode ? `Chapter ${item.episode.number} · ${formatClock(item.positionMs)}` : null
}

const isFound = (item: AudioBookmarkItem) => (item.kind === 'voice' ? item.place : item.episode) != null

export function ListeningBookmarks({ book }: { book: string }) {
  const api = useAudioBookmarks(book)
  const player = usePlayer()
  const id = useId()
  const section = useRef<HTMLElement>(null)
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  const { focusBookmarks, setFocusBookmarks } = player
  const reveals = useRef<number[]>([])
  useEffect(
    () => () => {
      for (const timer of reveals.current) window.clearTimeout(timer)
    },
    [],
  )
  useEffect(() => {
    if (!focusBookmarks) return
    setFocusBookmarks(false)
    const reveal = () => {
      const el = section.current
      const sheet = el?.closest<HTMLElement>('[role="dialog"]')
      if (el && sheet)
        sheet.scrollTop += el.getBoundingClientRect().top - sheet.getBoundingClientRect().top - SECTION_MARGIN
    }
    reveals.current = [window.setTimeout(reveal, 0), window.setTimeout(reveal, SLIDE_MS)]
  }, [focusBookmarks, setFocusBookmarks])

  const kind = bookmarkKind(player.now)
  const mine = api.items.filter((b) => b.kind === kind)

  return (
    <section
      ref={section}
      aria-labelledby={`${id}-title`}
      className="mt-8 border-t border-line pt-6"
      data-testid="player-bookmarks"
    >
      <h2 id={`${id}-title`} className="font-display text-[16px] font-semibold text-ink">
        Bookmarks in this book
      </h2>
      <BookmarksBody api={api} mine={mine} pathname={pathname} onSignIn={() => player.setExpanded(false)} />
    </section>
  )
}

const MESSAGE = 'mt-3 text-[14.5px] leading-relaxed text-muted'

function BookmarksBody({
  api,
  mine,
  pathname,
  onSignIn,
}: {
  api: AudioBookmarksApi
  mine: AudioBookmarkItem[]
  pathname: string
  onSignIn: () => void
}) {
  if (api.state === 'signed_out')
    return (
      <div className="mt-3 space-y-3 text-[14.5px]">
        <p className="text-body" data-testid="player-bookmarks-signed-out">
          Sign in to bookmark moments.
        </p>
        <Link
          to="/login"
          search={{ next: pathname }}
          onClick={onSignIn}
          data-testid="player-bookmarks-sign-in"
          className="inline-flex h-11 items-center rounded-full bg-accent-fill px-5 text-[14.5px] font-semibold text-on-accent transition hover:brightness-105"
        >
          Sign in
        </Link>
      </div>
    )
  if (api.state === 'loading' && mine.length === 0)
    return (
      <p className={MESSAGE} data-testid="player-bookmarks-loading">
        Loading your bookmarks…
      </p>
    )
  if (api.state === 'unavailable' && mine.length === 0)
    return (
      <div className="mt-3 flex flex-wrap items-center gap-3 text-[14.5px]">
        <p className="text-body" data-testid="player-bookmarks-error">
          Your bookmarks couldn’t be loaded.
        </p>
        <button
          type="button"
          onClick={api.retry}
          data-testid="player-bookmarks-retry"
          className="inline-flex h-11 items-center rounded-full border border-line px-4 font-medium text-ink transition hover:bg-panel"
        >
          Retry
        </button>
      </div>
    )
  if (mine.length === 0)
    return (
      <p className={MESSAGE} data-testid="player-bookmarks-empty">
        No bookmarks yet. Press Bookmark to mark a moment.
      </p>
    )

  const found = mine.filter(isFound)
  const missing = mine.filter((b) => !isFound(b))
  return (
    <>
      {found.length > 0 && (
        <ul className="mt-3 space-y-2">
          {found.map((item) => (
            <Row key={item.key} item={item} api={api} />
          ))}
        </ul>
      )}
      {missing.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-2 text-[13.5px] font-semibold text-ink">No longer found</h3>
          <ul className="space-y-2">
            {missing.map((item) => (
              <Row key={item.key} item={item} api={api} />
            ))}
          </ul>
        </div>
      )}
    </>
  )
}

function Row({ item, api }: { item: AudioBookmarkItem; api: AudioBookmarksApi }) {
  const player = usePlayer()
  const label = momentLabel(item)
  const play = () => player.playBookmark(item)
  const second =
    item.kind === 'voice'
      ? item.opening && <span className="mt-0.5 line-clamp-2 text-[14px] leading-snug text-body">{item.opening}…</span>
      : item.episode && (
          <span className="mt-0.5 line-clamp-2 text-[14px] leading-snug text-body">{item.episode.title}</span>
        )
  return (
    <li
      className="flex items-start gap-1 rounded-2xl border border-line bg-surface py-1.5 pr-1 pl-1.5"
      data-testid="player-bookmark"
      data-key={item.key}
    >
      {label ? (
        <button
          type="button"
          onClick={play}
          disabled={item.pending}
          data-testid="player-bookmark-play"
          data-key={item.key}
          className="block min-h-11 min-w-0 flex-1 rounded-xl px-2 py-1 text-left transition hover:bg-panel disabled:opacity-70"
        >
          <span className="block text-[13px] font-semibold text-muted tabular">{label}</span>
          {second}
        </button>
      ) : (
        <div className="min-w-0 flex-1 px-2 py-1">
          <span className="block line-clamp-2 text-[14px] leading-snug text-body">
            {item.kind === 'voice' ? `${item.opening}…` : 'Episode removed'}
          </span>
          <p className="mt-1 text-[13px] text-muted" data-testid="player-bookmark-missing" data-key={item.key}>
            This part of the book changed, so the bookmark can’t play it.
          </p>
        </div>
      )}
      <button
        type="button"
        onClick={() => api.remove(item.key)}
        aria-label={label ? `Remove bookmark, ${label}` : 'Remove bookmark'}
        title="Remove bookmark"
        data-testid="player-bookmark-remove"
        data-key={item.key}
        className="grid size-11 shrink-0 place-items-center rounded-full text-muted transition hover:bg-panel hover:text-ink"
      >
        <X className="size-4" aria-hidden />
      </button>
    </li>
  )
}
