import { useRouter } from '@tanstack/react-router'
import { RotateCcw, RotateCw, SkipBack, SkipForward, X } from 'lucide-react'
import { AnimatePresence } from 'motion/react'
import { SpeechDock } from '~/client/features/read-aloud/SpeechDock'
import { SpeechSheet } from '~/client/features/read-aloud/SpeechSheet'
import { formatClock, formatDuration } from '~/client/lib/format'
import { BookmarkMomentButton } from './BookmarkMomentButton'
import { ChaptersMenu } from './ChaptersMenu'
import { ListeningBookmarks } from './ListeningBookmarks'
import {
  DockFrame,
  DockSummary,
  dockButton,
  PlayButton,
  ProgressSlider,
  pill,
  roundButton,
  SheetFrame,
  SheetSettings,
  SheetTitle,
  SleepBadge,
  SpeedButton,
} from './PlayerFrames'
import { usePlayer } from './PlayerProvider'
import { SleepMenu } from './SleepMenu'
import { label } from './sleep'

export function PlayerDock() {
  const player = usePlayer()
  const { expanded } = player
  const { source } = player.now
  return (
    <>
      <AnimatePresence>
        {source === 'audio' && !expanded && <AudioDock key="audio" />}
        {source === 'speech' && !expanded && <SpeechDock key="speech" />}
      </AnimatePresence>
      <AnimatePresence>
        {source === 'audio' && expanded && <ExpandedPlayer key="audio-sheet" />}
        {source === 'speech' && expanded && <SpeechSheet key="speech-sheet" />}
      </AnimatePresence>
    </>
  )
}

function AudioDock() {
  const player = usePlayer()
  const { current, book } = player
  if (!current || !book) return null
  const ratio = player.durationMs > 0 ? Math.min(1, player.positionMs / player.durationMs) : 0
  return (
    <DockFrame label="Audio player" ratio={ratio}>
      <DockSummary
        onOpen={() => player.setExpanded(true)}
        cover={book}
        title={current.title}
        subtitle={`Chapter ${current.number} · ${book.title}`}
      />
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => player.skip(-15_000)}
          aria-label="Back 15 seconds"
          className={dockButton}
          data-testid="player-back"
        >
          <RotateCcw className="size-5" aria-hidden />
        </button>
        <PlayButton size="sm" playing={player.playing} onClick={player.toggle} />
        <button
          type="button"
          onClick={() => player.skip(15_000)}
          aria-label="Forward 15 seconds"
          className={dockButton}
          data-testid="player-forward"
        >
          <RotateCw className="size-5" aria-hidden />
        </button>
      </div>
      <BookmarkMomentButton variant="dock" book={book.slug} />
      <SleepBadge text={label(player.sleep, 'episode')} />
      <span
        className="hidden min-w-[96px] text-right text-[13px] text-subtle tabular sm:block"
        data-testid="player-time"
      >
        {formatClock(player.positionMs)} / {formatClock(player.durationMs)}
      </span>
      <button
        type="button"
        onClick={player.close}
        aria-label="Close player"
        className={dockButton}
        data-testid="player-close"
      >
        <X className="size-5" />
      </button>
    </DockFrame>
  )
}

function ExpandedPlayer() {
  const player = usePlayer()
  const router = useRouter()
  const { current, book } = player
  if (!current || !book) return null
  const open = (href: string) => {
    player.setExpanded(false)
    void router.navigate({ href })
  }
  const pageHref = current.pageHref
  const goToPage = pageHref ? () => open(pageHref) : undefined

  return (
    <SheetFrame cover={book} onClose={player.close} onToggle={player.toggle}>
      <p className="eyebrow text-accent" data-testid="player-chapter-number">
        Chapter {current.number}
      </p>
      <SheetTitle onClick={goToPage ?? (() => open(book.href))}>{current.title}</SheetTitle>
      <p className="mt-3 text-[15px] text-muted tabular" data-testid="player-duration">
        {formatDuration(current.durationMs)}
      </p>

      <ProgressSlider
        value={player.positionMs}
        max={player.durationMs}
        step={1000}
        valueText={`${formatClock(player.positionMs)} of ${formatClock(player.durationMs)}`}
        onChange={player.seek}
      />
      <div className="mt-2 flex justify-between text-[13px] text-muted tabular">
        <span data-testid="player-elapsed">{formatClock(player.positionMs)}</span>
        <span data-testid="player-remaining">
          {formatClock(Math.max(0, player.durationMs - player.positionMs), { remaining: true })}
        </span>
      </div>

      <div className="mt-6 flex items-center gap-3 sm:gap-5">
        <button
          type="button"
          onClick={player.prev}
          disabled={!player.hasPrev}
          aria-label="Previous"
          className={roundButton}
          data-testid="player-previous"
        >
          <SkipBack className="size-5" fill="currentColor" />
        </button>
        <button
          type="button"
          onClick={() => player.skip(-15_000)}
          className={pill}
          aria-label="Back 15s"
          data-testid="player-back"
        >
          <RotateCcw className="size-4" aria-hidden />
          15s
        </button>
        <PlayButton size="lg" playing={player.playing} onClick={player.toggle} />
        <button
          type="button"
          onClick={() => player.skip(15_000)}
          className={pill}
          aria-label="Forward 15s"
          data-testid="player-forward"
        >
          15s
          <RotateCw className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={player.next}
          disabled={!player.hasNext}
          aria-label="Next"
          className={roundButton}
          data-testid="player-next"
        >
          <SkipForward className="size-5" fill="currentColor" />
        </button>
      </div>

      <SheetSettings onGoToPage={goToPage}>
        <ChaptersMenu />
        <SpeedButton speed={player.speed} onClick={player.cycleSpeed} />
        <SleepMenu part="episode" />
        <BookmarkMomentButton variant="sheet" book={book.slug} />
      </SheetSettings>
      <ListeningBookmarks book={book.slug} />
    </SheetFrame>
  )
}
