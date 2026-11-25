import { Pause, Play } from 'lucide-react'
import { useEffect, useState } from 'react'
import { BackLink } from '~/client/components/BackLink'
import { Notice } from '~/client/features/account/ui'
import { usePlayer } from '~/client/features/player/PlayerProvider'
import { continueEpisode } from '~/client/features/player/position-store'
import { BookRating } from '~/client/features/ratings/BookRating'
import { AddToShelf } from '~/client/features/shelves/AddToShelf'
import { onSynced } from '~/client/features/sync/engine'
import { cn } from '~/client/lib/cn'
import { browserStorage } from '~/client/lib/storage-keys'
import { formatLength } from '~/shared/audiobooks/chapters'
import { MY_BOOKS_HREF, type PrivateAudiobookPage as Page } from '~/shared/content/private-book'
import type { RatingState } from '~/shared/ratings/ratings'
import {
  About,
  BookHeader,
  CoverAndDetails,
  CoverPrompt,
  DeleteBook,
  type PageNotice,
  SectionTitle,
  useCoverActions,
} from './PrivateBookPage'

function useContinueEpisode(page: Page): string | null {
  const player = usePlayer()
  const [episode, setEpisode] = useState<string | null>(null)
  const ids = page.player.episodes.map((e) => e.id).join(' ')
  const playing = player.book?.slug === page.slug ? player.current?.id : undefined
  // biome-ignore lint/correctness/useExhaustiveDependencies: `playing` isn't read inside; a new chapter playing is the cue to read the stored positions again.
  useEffect(() => {
    const read = () => setEpisode(continueEpisode(browserStorage(), page.slug, ids.split(' ')))
    read()
    return onSynced((kinds) => {
      if (kinds.includes('listening')) read()
    })
  }, [page.slug, ids, playing])
  return episode
}

function Header({ page, rating }: { page: Page; rating: RatingState }) {
  const player = usePlayer()
  const resume = useContinueEpisode(page)
  const { book, episodes } = page.player
  const listen = () => {
    const id = resume ?? episodes[0]?.id
    if (id && !(player.book?.slug === page.slug && player.current?.id === id && player.playing))
      player.play(book, episodes, id)
  }
  return (
    <BookHeader
      page={page}
      eyebrow="My shelf · Audiobook"
      titleTestId="private-audiobook-title"
      narrator={page.narrator}
    >
      <div className="mt-7 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={listen}
          data-testid="private-audiobook-listen"
          className="inline-flex h-12 items-center gap-2 rounded-xl bg-accent-fill px-6 text-[15px] font-bold text-on-accent transition hover:-translate-y-0.5 active:scale-[.98]"
        >
          <Play className="size-4" fill="currentColor" aria-hidden />
          {resume ? 'Continue listening' : 'Listen'}
        </button>
        <AddToShelf slug={page.slug} />
      </div>
      <BookRating slug={page.slug} rating={rating} />
    </BookHeader>
  )
}

function Chapters({ page }: { page: Page }) {
  const player = usePlayer()
  const { book, episodes } = page.player
  return (
    <section aria-labelledby="chapters-title">
      <SectionTitle id="chapters-title">Chapters</SectionTitle>
      <ol className="mt-4 space-y-2">
        {episodes.map((episode) => {
          const current = player.book?.slug === page.slug && player.current?.id === episode.id
          const playing = current && player.playing
          const Icon = playing ? Pause : Play
          return (
            <li key={episode.id}>
              <button
                type="button"
                onClick={() => player.play(book, episodes, episode.id)}
                aria-pressed={current}
                data-testid="private-audiobook-chapter"
                data-key={episode.id}
                className={cn(
                  'flex w-full items-center gap-4 rounded-2xl border px-4 py-3 text-left transition',
                  current ? 'border-accent-line bg-panel' : 'border-line bg-surface hover:border-accent-line',
                )}
              >
                <span
                  className={cn(
                    'grid size-10 shrink-0 place-items-center rounded-full transition',
                    current ? 'bg-accent-fill text-on-accent' : 'bg-panel text-accent',
                  )}
                >
                  <Icon className={cn('size-4', !playing && 'translate-x-[1px]')} fill="currentColor" aria-hidden />
                </span>
                <span
                  className={cn(
                    'min-w-0 flex-1 text-[16px] font-semibold break-words',
                    current ? 'text-accent' : 'text-ink',
                  )}
                >
                  <span className="sr-only">{playing ? 'Pause' : 'Play'} </span>
                  {episode.number}. {episode.title}
                  <span className="font-normal text-subtle"> · {formatLength(episode.durationMs)}</span>
                </span>
                {current && (
                  <span
                    className="shrink-0 text-[13px] font-semibold text-accent"
                    data-testid="private-audiobook-playing"
                  >
                    Playing
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

export function PrivateAudiobookPage({
  page,
  notices,
  rating,
}: {
  page: Page
  notices: PageNotice[]
  rating: RatingState
}) {
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])
  const actions = useCoverActions(page)
  return (
    <main id="main" className="page-wrap pt-7" style={{ paddingBottom: 'var(--player-h)' }}>
      <BackLink href={MY_BOOKS_HREF} label="My books" />
      {notices.map((n) => (
        <Notice key={n.text} kind={n.kind} data-testid={n.testId}>
          {n.text}
        </Notice>
      ))}
      <Header page={page} rating={rating} />
      {hydrated && !page.image && <CoverPrompt actions={actions} />}
      <div className="grid gap-12 py-12">
        <About page={page} />
        <Chapters page={page} />
        <CoverAndDetails page={page} actions={hydrated ? actions : null} />
      </div>
      <DeleteBook
        page={page}
        text="Deleted audiobooks are removed at once, file and all. Audiobook files aren’t in Folio’s backups, so keep your own copy."
      />
    </main>
  )
}
