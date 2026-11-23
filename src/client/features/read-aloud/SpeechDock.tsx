import { Link, useRouter, useRouterState } from '@tanstack/react-router'
import { KeyRound, LocateFixed, RotateCw, Smartphone, StepBack, StepForward, X } from 'lucide-react'
import { BookmarkMomentButton } from '~/client/features/player/BookmarkMomentButton'
import { DockFrame, DockSummary, dockButton, PlayButton, SleepBadge } from '~/client/features/player/PlayerFrames'
import { usePlayer } from '~/client/features/player/PlayerProvider'
import { label } from '~/client/features/player/sleep'
import { offersDeviceVoice, problemLink, problemMessage } from './messages'

const ENGINE_NAMES = { device: 'Device voice', cloud: 'ElevenLabs', local: 'Folio voice' } as const

const wideButton =
  'inline-flex h-11 shrink-0 items-center gap-2 rounded-full px-2.5 text-[14px] font-medium text-body transition hover:bg-panel hover:text-ink sm:border sm:border-line sm:px-3.5'

export function SpeechDock() {
  const player = usePlayer()
  const ra = player.readAloud
  const router = useRouter()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { book, page } = ra
  if (!book) return null
  const inBook = pathname.startsWith(`/read/${book.slug}/`)
  const showFollow = page !== null && (!ra.following || !inBook)
  const follow = () => {
    ra.setFollowing(true)
    const column = inBook && document.documentElement.getAttribute('data-reader-layout') === 'scroll'
    if (page) void router.navigate({ href: page.href, resetScroll: !column })
  }
  const message = ra.problem ? problemMessage(ra.problem) : null
  return (
    <DockFrame label="Read aloud" ratio={ra.fraction}>
      <DockSummary
        onOpen={() => player.setExpanded(true)}
        cover={book}
        title={book.title}
        subtitle={message ?? [page?.label, ENGINE_NAMES[ra.engine]].filter(Boolean).join(' · ')}
      />
      <p role="status" className="sr-only" data-testid="speech-problem">
        {message}
      </p>
      {problemLink(ra.problem) && (
        <Link
          to="/account/api-keys"
          hash="elevenlabs"
          className={dockButton}
          aria-label="API keys page"
          data-testid="speech-api-keys"
        >
          <KeyRound className="size-5" aria-hidden />
        </Link>
      )}
      {offersDeviceVoice(ra.problem) && (
        <button type="button" onClick={ra.useDeviceVoice} className={wideButton} data-testid="speech-use-device-voice">
          <Smartphone className="size-5 sm:size-4" aria-hidden />
          <span className="max-sm:sr-only">Use device voice</span>
        </button>
      )}
      {ra.problem?.kind === 'load-failed' && (
        <button type="button" onClick={ra.retry} className={dockButton} aria-label="Retry" data-testid="speech-retry">
          <RotateCw className="size-5" aria-hidden />
        </button>
      )}
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={ra.prevSentence}
          aria-label="Previous sentence"
          className={dockButton}
          data-testid="speech-previous-sentence"
        >
          <StepBack className="size-5" aria-hidden />
        </button>
        <PlayButton size="sm" playing={ra.status === 'playing'} onClick={ra.toggle} />
        <button
          type="button"
          onClick={ra.nextSentence}
          aria-label="Next sentence"
          className={dockButton}
          data-testid="speech-next-sentence"
        >
          <StepForward className="size-5" aria-hidden />
        </button>
      </div>
      <BookmarkMomentButton variant="dock" book={book.slug} />
      {showFollow && (
        <button type="button" onClick={follow} className={wideButton} data-testid="speech-follow">
          <LocateFixed className="size-5 sm:size-4" aria-hidden />
          <span className="max-sm:sr-only">Follow the voice</span>
        </button>
      )}
      <SleepBadge text={label(player.sleep, 'chapter')} />
      <button
        type="button"
        onClick={ra.close}
        aria-label="Close player"
        className={dockButton}
        data-testid="player-close"
      >
        <X className="size-5" />
      </button>
    </DockFrame>
  )
}
