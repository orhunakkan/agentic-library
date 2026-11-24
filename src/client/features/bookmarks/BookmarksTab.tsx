import { Link } from '@tanstack/react-router'
import { Headphones, Play, X } from 'lucide-react'
import { type ReactNode, useId } from 'react'
import { AppLink } from '~/client/components/AppLink'
import { usePlayer } from '~/client/features/player/PlayerProvider'
import { type TabEntry, tabOrder } from '~/shared/bookmarks/audio'
import type { BookmarkPlace } from '~/shared/bookmarks/bookmarks'
import { fromStored } from '~/shared/content/position'
import type { ReaderView } from '~/shared/content/reader-view'
import type { AudioBookmarkItem, AudioBookmarksApi } from './use-audio-bookmarks'
import type { BookmarkItem, BookmarksApi } from './use-bookmarks'

export function bookmarkCount(api: BookmarksApi, audio: AudioBookmarksApi | null): number {
  return api.items.length + (audio?.items.filter((b) => b.kind === 'voice').length ?? 0)
}

export function BookmarksTab({
  api,
  audio,
  canPlay,
  view,
  onNavigate,
  offline = false,
}: {
  api: BookmarksApi
  audio: AudioBookmarksApi | null
  canPlay: boolean
  view: ReaderView
  onNavigate?: () => void
  offline?: boolean
}) {
  const id = useId()
  const message = 'px-2 py-4 text-[14px] leading-relaxed text-r-muted'
  if (offline)
    return (
      <p data-testid="bookmarks-offline" className={message}>
        Bookmarks show here when you’re back online.
      </p>
    )
  if (api.state === 'signed_out') {
    return (
      <div className="space-y-3 px-2 py-4 text-[14px] leading-relaxed">
        <p>Sign in to bookmark pages in this book.</p>
        <Link
          to="/login"
          data-testid="bookmarks-sign-in"
          search={{ next: view.canonicalPath }}
          className="inline-flex h-11 items-center rounded-xl bg-r-accent px-5 text-[14.5px] font-semibold text-r-paper transition hover:brightness-105"
        >
          Sign in
        </Link>
      </div>
    )
  }
  if (api.state === 'loading')
    return (
      <p data-testid="bookmarks-loading" className={message}>
        Loading your bookmarks…
      </p>
    )
  if (api.state === 'unavailable') {
    return (
      <div className="space-y-3 px-2 py-4 text-[14px]">
        <p data-testid="bookmarks-error">Your bookmarks couldn’t be loaded.</p>
        <button
          type="button"
          data-testid="bookmarks-retry"
          onClick={api.retry}
          className="inline-flex h-10 items-center rounded-full border border-r-line px-4 text-[13.5px] font-medium transition hover:border-r-accent/60"
        >
          Retry
        </button>
      </div>
    )
  }
  if (api.state === 'off') return null

  const all = tabOrder(api.items, audio?.items ?? [])
  const found = all.filter((e) => e.bookmark.place)
  const missing = all.filter((e) => !e.bookmark.place)
  if (all.length === 0) {
    return (
      <p data-testid="bookmarks-empty" className={message}>
        No bookmarks yet. Press the ribbon at the top of a page to bookmark it, or Bookmark in the player to mark a
        moment while listening.
      </p>
    )
  }
  const entry = (e: TabEntry, navigate?: () => void) => {
    if (e.kind === 'page') {
      const item = e.bookmark as BookmarkItem
      return <Entry key={item.key} item={item} api={api} current={view.canonicalPath} onNavigate={navigate} />
    }
    const item = e.bookmark as AudioBookmarkItem & { kind: 'voice' }
    return (
      <VoiceEntry
        key={item.key}
        item={item}
        audio={audio}
        canPlay={canPlay}
        book={view.book.slug}
        current={view.canonicalPath}
        onNavigate={navigate}
      />
    )
  }
  return (
    <div className="space-y-6 px-2 pt-2 pb-4">
      {found.length > 0 && <ul className="space-y-2">{found.map((e) => entry(e, onNavigate))}</ul>}
      {missing.length > 0 && (
        <section aria-labelledby={`${id}-missing`}>
          <h3 id={`${id}-missing`} className="mb-2 px-1 text-[13px] font-semibold text-r-ink">
            Pages no longer found
          </h3>
          <ul className="space-y-2">{missing.map((e) => entry(e))}</ul>
        </section>
      )}
    </div>
  )
}

function PageLink({
  itemKey,
  place,
  opening,
  current,
  tag,
  onNavigate,
}: {
  itemKey: string
  place: BookmarkPlace | null
  opening: string
  current: string
  tag?: ReactNode
  onNavigate?: () => void
}) {
  const words = opening && (
    <span className="mt-1 line-clamp-2 font-serif text-[14px] leading-[1.5] text-r-ink [overflow-wrap:anywhere]">
      {opening}…
    </span>
  )
  if (!place) {
    return (
      <div className="min-w-0 flex-1 px-1.5 py-1">
        {words}
        <p className="mt-1.5 text-[12.5px] text-r-muted">This page changed or moved, so the bookmark can’t open it.</p>
      </div>
    )
  }
  const here = place.pageHref === current
  return (
    <AppLink
      href={place.pageHref}
      data-testid="bookmark-link"
      data-key={itemKey}
      preload={false}
      onClick={onNavigate}
      aria-current={here ? 'page' : undefined}
      className="block min-w-0 flex-1 rounded-lg px-1.5 py-1 transition hover:bg-r-line/40"
    >
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="text-[12.5px] font-semibold text-r-muted">
          {place.chapterIndex + 1}. {place.chapterTitle}
        </span>
        <span className="inline-flex min-h-6 items-center rounded-full bg-r-accent/12 px-2 text-[12px] font-medium text-r-accent">
          {place.label}
        </span>
        {tag}
        {here && <span className="text-[12px] font-medium text-r-muted">This page</span>}
      </span>
      {words}
    </AppLink>
  )
}

function Entry({
  item,
  api,
  current,
  onNavigate,
}: {
  item: BookmarkItem
  api: BookmarksApi
  current: string
  onNavigate?: () => void
}) {
  const place = item.place
  return (
    <li
      data-testid="bookmark-item"
      data-key={item.key}
      className="flex items-start gap-1 rounded-xl border border-r-line bg-r-paper py-1.5 pr-1 pl-1.5"
    >
      <PageLink itemKey={item.key} place={place} opening={item.opening} current={current} onNavigate={onNavigate} />
      <button
        type="button"
        data-testid="bookmark-remove"
        data-key={item.key}
        onClick={() => api.remove(item.key)}
        aria-label={place ? `Remove bookmark, ${place.label}` : 'Remove bookmark'}
        title="Remove bookmark"
        className="grid size-11 shrink-0 place-items-center rounded-full text-r-muted transition hover:bg-r-line/60 hover:text-r-ink"
      >
        <X className="size-4" aria-hidden />
      </button>
    </li>
  )
}

function VoiceEntry({
  item,
  audio,
  canPlay,
  book,
  current,
  onNavigate,
}: {
  item: AudioBookmarkItem & { kind: 'voice' }
  audio: AudioBookmarksApi | null
  canPlay: boolean
  book: string
  current: string
  onNavigate?: () => void
}) {
  const { readAloud } = usePlayer()
  const place = item.place
  const play = () => {
    if (!place) return
    readAloud.start(book, {
      kind: 'offset',
      chapter: place.chapterIndex,
      position: fromStored(place.chapter, place.page),
      offset: place.start,
    })
  }
  const iconButton =
    'grid size-11 shrink-0 place-items-center rounded-full text-r-muted transition hover:bg-r-line/60 hover:text-r-ink disabled:opacity-40'
  return (
    <li
      data-testid="bookmark-listening-item"
      data-key={item.key}
      className="flex items-start gap-1 rounded-xl border border-r-line bg-r-paper py-1.5 pr-1 pl-1.5"
    >
      <PageLink
        itemKey={item.key}
        place={place}
        opening={item.opening}
        current={current}
        tag={
          <span className="inline-flex items-center gap-1 text-[12px] font-medium text-r-muted">
            <Headphones className="size-3" aria-hidden />
            Listening
          </span>
        }
        onNavigate={onNavigate}
      />
      {place && canPlay && (
        <button
          type="button"
          data-testid="bookmark-play"
          data-key={item.key}
          onClick={play}
          disabled={item.pending}
          aria-label={`Play from here, ${place.label}`}
          title="Play from here"
          className={iconButton}
        >
          <Play className="size-4" aria-hidden />
        </button>
      )}
      <button
        type="button"
        data-testid="bookmark-remove"
        data-key={item.key}
        onClick={() => audio?.remove(item.key)}
        aria-label={place ? `Remove bookmark, ${place.label}` : 'Remove bookmark'}
        title="Remove bookmark"
        className={iconButton}
      >
        <X className="size-4" aria-hidden />
      </button>
    </li>
  )
}
