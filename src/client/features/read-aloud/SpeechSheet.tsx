import { Link, useRouter } from '@tanstack/react-router'
import { RotateCw, SkipBack, SkipForward, StepBack, StepForward } from 'lucide-react'
import { useState } from 'react'
import { BookmarkMomentButton } from '~/client/features/player/BookmarkMomentButton'
import { ChaptersMenu } from '~/client/features/player/ChaptersMenu'
import { ListeningBookmarks } from '~/client/features/player/ListeningBookmarks'
import {
  PlayButton,
  ProgressSlider,
  roundButton,
  SheetFrame,
  SheetSettings,
  SheetTitle,
  SpeedButton,
} from '~/client/features/player/PlayerFrames'
import { usePlayer } from '~/client/features/player/PlayerProvider'
import { nextSpeed } from '~/client/features/player/queue'
import { SleepMenu } from '~/client/features/player/SleepMenu'
import { FolioOffer } from './FolioOffer'
import { offersDeviceVoice, problemLink, problemMessage, timeLeft } from './messages'
import { VoiceMenu } from './VoiceMenu'

export function SpeechSheet() {
  const { readAloud: ra, setExpanded } = usePlayer()
  const router = useRouter()
  const [dragging, setDragging] = useState<number | null>(null)
  const { book, chapter, page } = ra
  if (!book || !chapter) return null
  const percent = dragging ?? Math.round(ra.fraction * 100)
  const goToPage = () => {
    setExpanded(false)
    ra.setFollowing(true)
    if (page) void router.navigate({ href: page.href })
  }
  const message = ra.problem ? problemMessage(ra.problem) : null

  return (
    <SheetFrame cover={book} onClose={ra.close} onToggle={ra.toggle}>
      <p className="eyebrow text-accent" data-testid="speech-chapter-number">
        Chapter {chapter.index + 1}
      </p>
      <SheetTitle onClick={goToPage}>{chapter.title}</SheetTitle>
      <p className="mt-3 text-[15px] text-muted" data-testid="speech-time-left">
        {timeLeft(ra.minutesLeft)}
      </p>

      <ProgressSlider
        value={percent}
        max={100}
        step={1}
        valueText={`${percent}% of the chapter`}
        onChange={setDragging}
        onCommit={(value) => {
          setDragging(null)
          ra.seekFraction(value / 100)
        }}
      />
      <div className="mt-2 flex justify-between text-[13px] text-muted tabular">
        <span data-testid="speech-page-label">{page?.label}</span>
        <span data-testid="speech-percent">{percent}%</span>
      </div>

      <div role="status" data-testid="speech-problem" className="min-h-6 pt-3 text-[14px] text-body">
        {message}
        {problemLink(ra.problem) && (
          <Link
            to="/account/api-keys"
            hash="elevenlabs"
            className="ml-3 font-semibold text-accent"
            data-testid="speech-api-keys"
          >
            API keys
          </Link>
        )}
        {offersDeviceVoice(ra.problem) && (
          <button
            type="button"
            onClick={ra.useDeviceVoice}
            className="ml-3 font-semibold text-accent"
            data-testid="speech-use-device-voice"
          >
            Use device voice
          </button>
        )}
        {ra.problem?.kind === 'load-failed' && (
          <button
            type="button"
            onClick={ra.retry}
            data-testid="speech-retry"
            className="ml-3 inline-flex items-center gap-1.5 font-semibold text-accent"
          >
            <RotateCw className="size-4" aria-hidden />
            Retry
          </button>
        )}
      </div>

      <div className="mt-3 flex items-center gap-3 sm:gap-5">
        <button
          type="button"
          onClick={ra.prevChapter}
          disabled={chapter.index === 0}
          aria-label="Previous chapter"
          className={roundButton}
          data-testid="speech-previous-chapter"
        >
          <SkipBack className="size-5" fill="currentColor" />
        </button>
        <button
          type="button"
          onClick={ra.prevSentence}
          aria-label="Previous sentence"
          className={roundButton}
          data-testid="speech-previous-sentence"
        >
          <StepBack className="size-5" />
        </button>
        <PlayButton size="lg" playing={ra.status === 'playing'} onClick={ra.toggle} />
        <button
          type="button"
          onClick={ra.nextSentence}
          aria-label="Next sentence"
          className={roundButton}
          data-testid="speech-next-sentence"
        >
          <StepForward className="size-5" />
        </button>
        <button
          type="button"
          onClick={ra.nextChapter}
          disabled={chapter.index + 1 >= chapter.chapterCount}
          aria-label="Next chapter"
          className={roundButton}
          data-testid="speech-next-chapter"
        >
          <SkipForward className="size-5" fill="currentColor" />
        </button>
      </div>

      <FolioOffer />
      <SheetSettings onGoToPage={goToPage}>
        <ChaptersMenu />
        <SpeedButton speed={ra.rate} onClick={() => ra.setRate(nextSpeed(ra.rate))} />
        <VoiceMenu />
        <SleepMenu part="chapter" />
        <BookmarkMomentButton variant="sheet" book={book.slug} />
      </SheetSettings>
      <ListeningBookmarks book={book.slug} />
    </SheetFrame>
  )
}
