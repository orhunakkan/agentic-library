import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { BookOpen, Headphones, Pause, Play, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { AppLink } from '~/client/components/AppLink'
import { BackLink } from '~/client/components/BackLink'
import { BookCover } from '~/client/components/BookCover'
import { ReadAloudButton } from '~/client/features/library/ReadAloudButton'
import { StartOrContinue } from '~/client/features/library/StartOrContinue'
import { DownloadButton } from '~/client/features/offline/DownloadButton'
import { usePlayer } from '~/client/features/player/PlayerProvider'
import { BookRating } from '~/client/features/ratings/BookRating'
import { RemoveFromLibrary } from '~/client/features/removed-books/RemoveFromLibrary'
import { AddToShelf } from '~/client/features/shelves/AddToShelf'
import { cn } from '~/client/lib/cn'
import { formatDuration, pad2 } from '~/client/lib/format'
import { HUE_CLASSES } from '~/client/lib/hue-classes'
import { getBookPage, searchInBook } from '~/server/functions'
import { type BookSearchHit, IN_BOOK_HIT_LIMIT } from '~/shared/content/book-search'
import { catalogCoverImage } from '~/shared/content/library'
import { matchesQuery } from '~/shared/lib/search'
import { SITE_NAME } from '~/shared/lib/site'
import { englishName } from '~/shared/lookup/languages'

export const Route = createFileRoute('/library/$series/$book')({
  validateSearch: (search: Record<string, unknown>): { tab?: 'audio' } =>
    search.tab === 'audio' ? { tab: 'audio' } : {},
  loader: ({ params }) => getBookPage({ data: { series: params.series, book: params.book } }),
  head: ({ loaderData }) => {
    if (!loaderData) return {}
    const { meta } = loaderData
    return {
      meta: [
        { title: `${meta.title} | ${SITE_NAME}` },
        { name: 'description', content: meta.shortDescription },
        { property: 'og:title', content: meta.title },
        { property: 'og:description', content: meta.shortDescription },
        { property: 'og:type', content: 'book' },
        { property: 'og:image', content: `/og/book/${meta.slug}.png` },
      ],
      links: [{ rel: 'canonical', href: `/library/${meta.seriesSlug}/${meta.slug}` }],
    }
  },
  component: BookPage,
})

function BookPage() {
  const page = Route.useLoaderData()
  const { tab } = Route.useSearch()
  const navigate = useNavigate({ from: '/library/$series/$book' })
  const player = usePlayer()
  const { meta, audio } = page
  const showAudio = tab === 'audio' && audio !== null

  const setTab = (next: 'text' | 'audio') =>
    navigate({ search: next === 'audio' ? { tab: 'audio' } : {}, replace: true, resetScroll: false })

  const listen = () => {
    setTab('audio')
    const first = audio?.episodes[0]
    if (audio && first && player.book?.slug !== meta.slug) player.play(audio.book, audio.episodes, first.id)
    requestAnimationFrame(() =>
      document.getElementById('contents')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    )
  }

  return (
    <main id="main" className="page-wrap pt-7" style={{ paddingBottom: 'var(--player-h)' }}>
      <BookHero onListen={listen} />

      <div className="grid gap-12 py-12 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div id="contents" className="min-w-0 scroll-mt-[calc(var(--site-nav-h)+24px)]">
          {audio && <FormatTabs showAudio={showAudio} onSelect={setTab} />}
          {showAudio ? <AudioList /> : <Contents />}
        </div>

        {page.siblings.length > 0 && <MoreFromSeries />}
      </div>

      <Colophon />
    </main>
  )
}

function BookHero({ onListen }: { onListen: () => void }) {
  const page = Route.useLoaderData()
  const { meta, audio } = page
  const colors = HUE_CLASSES[page.hue]
  return (
    <>
      <BackLink href={page.back.href} label={page.back.label} />
      <section
        aria-labelledby="book-title"
        className={cn(
          'mt-5 grid gap-8 rounded-[24px] border p-6 md:grid-cols-[220px_1fr] md:p-10 xl:grid-cols-[220px_1fr_260px] xl:items-end xl:gap-10',
          colors.tint,
        )}
      >
        <BookCover
          title={meta.title}
          author={meta.author}
          cover={meta.cover}
          image={catalogCoverImage(meta)}
          priority
          transitionName={`cover-${meta.slug}`}
          className="w-[150px] shadow-[0_12px_28px_-14px_rgb(0_0_0/0.6)] md:w-[220px]"
        />
        <div className="min-w-0 self-end">
          <p className={cn('eyebrow', colors.ink)}>{page.seriesTitle}</p>
          <h1
            id="book-title"
            data-testid="book-title"
            className="mt-3 font-display text-[clamp(34px,4vw,52px)] leading-[1.05] font-bold tracking-[-0.03em] text-balance text-ink"
          >
            {meta.title}
          </h1>
          <p className="mt-2 text-[15px] text-muted">{meta.author}</p>
          <p className="mt-4 line-clamp-5 max-w-[56ch] text-[16.5px] leading-relaxed text-body">
            {meta.shortDescription}
          </p>
          <StartOrContinue slug={meta.slug} startHref={page.startHref}>
            {audio && (
              <button
                type="button"
                onClick={onListen}
                data-testid="book-listen"
                className="inline-flex h-12 items-center gap-2 rounded-xl bg-hue-cyan px-6 text-[15px] font-semibold text-on-hue transition hover:-translate-y-0.5 active:scale-[.98]"
              >
                <Play className="size-4" fill="currentColor" aria-hidden />
                Listen
              </button>
            )}
            <ReadAloudButton slug={meta.slug} />
            <AddToShelf slug={meta.slug} />
            <DownloadButton slug={meta.slug} title={meta.title} />
            <RemoveFromLibrary slug={meta.slug} removed={page.removed} />
          </StartOrContinue>
          <BookRating slug={meta.slug} rating={page.rating} />
        </div>
        <dl className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-3 md:col-span-2 xl:col-span-1 xl:grid-cols-1">
          <Fact label="Chapters" value={String(meta.chapterCount)} />
          {audio && <Fact label="Audiobook" value={formatDuration(audio.totalMs)} />}
          <Fact label="Language" value={englishName(meta.language)} />
        </dl>
      </section>
    </>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-surface/70 p-5" data-testid="book-fact" data-key={label.toLowerCase()}>
      <dt className="text-[13px] text-subtle">{label}</dt>
      <dd className="mt-1 font-display text-[18px] font-semibold text-ink">{value}</dd>
    </div>
  )
}

function FormatTabs({ showAudio, onSelect }: { showAudio: boolean; onSelect: (tab: 'text' | 'audio') => void }) {
  return (
    <div
      role="tablist"
      aria-label="Format"
      data-testid="book-format-tabs"
      className="mb-8 inline-flex rounded-full border border-line bg-surface p-1"
    >
      {(['text', 'audio'] as const).map((format) => {
        const selected = (format === 'audio') === showAudio
        return (
          <button
            key={format}
            type="button"
            role="tab"
            data-testid="book-format-tab"
            data-key={format}
            aria-selected={selected}
            onClick={() => onSelect(format)}
            className={cn(
              'inline-flex h-11 items-center gap-2 rounded-full px-5 text-[14px] font-semibold transition',
              selected ? 'bg-accent-fill text-on-accent' : 'text-muted hover:text-ink',
            )}
          >
            {format === 'text' ? (
              <BookOpen className="size-4" aria-hidden />
            ) : (
              <Headphones className="size-4" aria-hidden />
            )}
            {format === 'text' ? 'Text' : 'Audiobook'}
          </button>
        )
      })}
    </div>
  )
}

function MoreFromSeries() {
  const { siblings } = Route.useLoaderData()
  return (
    <aside aria-labelledby="siblings-title" className="xl:sticky xl:top-[calc(var(--site-nav-h)+24px)] xl:self-start">
      <div className="rounded-[22px] border border-line bg-surface p-5">
        <h2 id="siblings-title" className="eyebrow text-subtle">
          More from this series
        </h2>
        <ul className="mt-4 grid grid-cols-4 gap-3 xl:grid-cols-2">
          {siblings.map((sibling) => (
            <li key={sibling.slug}>
              <AppLink
                href={sibling.href}
                viewTransition
                title={sibling.title}
                className="group block"
                data-testid="book-sibling"
                data-key={sibling.slug}
              >
                <BookCover
                  title={sibling.title}
                  author={sibling.author}
                  cover={sibling.cover}
                  image={sibling.image}
                  transitionName={`cover-${sibling.slug}`}
                  className="shadow-[0_12px_28px_-14px_rgb(0_0_0/0.6)] transition group-hover:-translate-y-0.5"
                />
                <span className="mt-2 line-clamp-2 block text-[12.5px] leading-snug text-muted group-hover:text-accent">
                  {sibling.title}
                </span>
              </AppLink>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  )
}

function Colophon() {
  const { meta, audio } = Route.useLoaderData()
  return (
    <p className="pb-4 text-[13px] text-subtle">
      Text:{' '}
      <a
        className="text-accent underline underline-offset-2 hover:text-accent-strong"
        href={meta.source.url}
        data-testid="book-text-source"
        rel="noreferrer"
        target="_blank"
      >
        {meta.source.name}
      </a>{' '}
      · {meta.source.license}
      {audio && (
        <>
          {' '}
          · Audio:{' '}
          <a
            className="text-accent underline underline-offset-2 hover:text-accent-strong"
            href={audio.sourceUrl}
            data-testid="book-audio-source"
            rel="noreferrer"
            target="_blank"
          >
            {audio.credit}
          </a>
        </>
      )}
    </p>
  )
}

function Contents() {
  const page = Route.useLoaderData()
  const [query, setQuery] = useState('')
  const chapters = useMemo(() => page.toc.filter((c) => matchesQuery(query, [c.title])), [page.toc, query])
  const trimmed = query.trim()
  const hits = useInBookSearch(page.meta.slug, trimmed)

  return (
    <section aria-labelledby="toc-title">
      <div className="flex flex-wrap items-center gap-4">
        <h2 id="toc-title" className="eyebrow text-ink">
          Contents
        </h2>
        <span className="h-px flex-1 bg-line" aria-hidden />
        <div className="relative w-full sm:w-72">
          <Search
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-subtle"
            aria-hidden
          />
          <input
            type="search"
            data-testid="book-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search in book"
            aria-label="Search in book"
            className="h-12 w-full rounded-[14px] border border-line bg-surface pr-11 pl-10 text-[15px] text-ink outline-none transition placeholder:text-subtle focus:border-accent focus:ring-4 focus:ring-accent/15 [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              data-testid="book-search-clear"
              aria-label="Clear"
              className="absolute top-1/2 right-1 grid size-10 -translate-y-1/2 place-items-center rounded-[10px] text-subtle hover:bg-panel hover:text-ink"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {chapters.length > 0 ? (
        <ol className="mt-4">
          {chapters.map((chapter) => (
            <li key={chapter.href}>
              <AppLink
                href={chapter.href}
                preload={false}
                data-testid="book-chapter"
                data-key={chapter.href}
                className="group -mx-3 flex items-baseline gap-5 rounded-xl border-b border-line-soft px-3 py-3.5 transition hover:bg-panel"
              >
                <span className="w-7 shrink-0 text-[14px] text-subtle tabular">{pad2(chapter.number)}</span>
                <span className="font-sans text-[16px] text-ink transition group-hover:text-accent md:text-[17px]">
                  {chapter.title}
                </span>
              </AppLink>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-8 text-muted" data-testid="book-no-chapters">
          No chapters match “{trimmed}”.
        </p>
      )}

      {hits && <TextHits hits={hits} paged={page.kind === 'paged'} />}
    </section>
  )
}

function useInBookSearch(book: string, query: string): BookSearchHit[] | null {
  const [hits, setHits] = useState<BookSearchHit[] | null>(null)

  useEffect(() => {
    if (query.length < 2) {
      setHits(null)
      return
    }
    let live = true
    const timer = setTimeout(() => {
      searchInBook({ data: { book, q: query } })
        .then((r) => live && setHits(r))
        .catch(() => live && setHits([]))
    }, 220)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [query, book])

  return hits
}

function TextHits({ hits, paged }: { hits: BookSearchHit[]; paged: boolean }) {
  return (
    <div className="mt-10" aria-live="polite" data-testid="book-text-hits">
      <h3 className="eyebrow text-subtle" data-testid="book-hit-count">
        In the text · {hits.length === IN_BOOK_HIT_LIMIT ? `${IN_BOOK_HIT_LIMIT}+` : hits.length}{' '}
        {hits.length === 1 ? 'match' : 'matches'}
      </h3>
      <ul className="mt-3 space-y-2">
        {hits.map((hit) => (
          <li key={hit.href}>
            <AppLink
              href={hit.href}
              preload={false}
              data-testid="book-hit"
              data-key={hit.href}
              className="block rounded-2xl border border-line bg-surface p-4 transition hover:border-accent-line"
            >
              <span className="text-[12.5px] font-medium text-accent">
                {hit.chapterTitle} · {paged ? `p. ${hit.page}` : `page ${hit.page}`}
              </span>
              <span className="mt-1 block text-[15px] leading-relaxed text-body">
                {hit.snippet.map((part, i) =>
                  part.hit ? (
                    // biome-ignore lint/suspicious/noArrayIndexKey: snippet parts are static per result.
                    <mark key={i} className="rounded-sm bg-hue-amber/30 px-0.5 text-ink">
                      {part.text}
                    </mark>
                  ) : (
                    // biome-ignore lint/suspicious/noArrayIndexKey: snippet parts are static per result.
                    <span key={i}>{part.text}</span>
                  ),
                )}
              </span>
            </AppLink>
          </li>
        ))}
      </ul>
    </div>
  )
}

function AudioList() {
  const page = Route.useLoaderData()
  const player = usePlayer()
  const audio = page.audio
  if (!audio) return null
  return (
    <section aria-labelledby="audio-title">
      <div className="flex items-center gap-4">
        <h2 id="audio-title" className="eyebrow text-ink">
          Audiobook
        </h2>
        <span className="h-px flex-1 bg-line" aria-hidden />
        <span className="text-[13px] text-subtle" data-testid="book-audio-summary">
          {audio.episodes.length} chapters · {formatDuration(audio.totalMs)}
        </span>
      </div>
      <ol className="mt-4 space-y-2">
        {audio.episodes.map((episode) => {
          const isCurrent = player.book?.slug === page.meta.slug && player.current?.id === episode.id
          const playing = isCurrent && player.playing
          const Icon = playing ? Pause : Play
          return (
            <li key={episode.id}>
              <button
                type="button"
                onClick={() => player.play(audio.book, audio.episodes, episode.id)}
                data-testid="book-episode"
                data-key={episode.id}
                aria-pressed={isCurrent}
                className={cn(
                  'flex w-full items-center gap-4 rounded-2xl border px-4 py-3 text-left transition',
                  isCurrent ? 'border-accent-line bg-panel' : 'border-line bg-surface hover:border-accent-line',
                )}
              >
                <span
                  className={cn(
                    'grid size-10 shrink-0 place-items-center rounded-full transition',
                    isCurrent ? 'bg-accent-fill text-on-accent' : 'bg-panel text-accent',
                  )}
                >
                  <Icon className={cn('size-4', !playing && 'translate-x-[1px]')} fill="currentColor" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="sr-only">{playing ? 'Pause' : 'Play'} </span>
                  <span
                    className={cn('block truncate text-[16px] font-semibold', isCurrent ? 'text-accent' : 'text-ink')}
                  >
                    {episode.title}
                  </span>
                  <span className="block text-[13px] text-subtle">Chapter {episode.number}</span>
                </span>
                <span className="text-[13px] text-subtle tabular">{formatDuration(episode.durationMs)}</span>
              </button>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
