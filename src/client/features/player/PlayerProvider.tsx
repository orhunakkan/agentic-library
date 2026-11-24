import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useToast } from '~/client/components/Toast'
import { browserStorage } from '~/client/features/ask/thread-store'
import type { AudioBookmarkItem } from '~/client/features/bookmarks/audio-bookmark-list'
import { type DownloadNotice, noticeMessage, problemMessage } from '~/client/features/read-aloud/messages'
import { type ReadAloudApi, useReadAloud } from '~/client/features/read-aloud/use-read-aloud'
import { noteFinished } from '~/client/features/reading-stats/finish'
import { readingTime } from '~/client/features/reading-stats/reading-time'
import { syncOutbox } from '~/client/features/sync/outbox'
import { type Arbiter, type ArbiterState, createArbiter } from './arbitration'
import { createLockScreen, type LockScreen } from './media-session'
import { bookmarkPlay, type NowPlaying, nowPlaying, partsOf } from './now-playing'
import { SLEEP_OFF, type SleepChoice } from './sleep'
import { createTransport, IDLE_TRANSPORT, type MediaLike, type Transport, type TransportState } from './transport'

interface PlayerApi
  extends TransportState,
    Pick<Transport, 'play' | 'playAt' | 'toggle' | 'seek' | 'skip' | 'prev' | 'next' | 'cycleSpeed' | 'close'>,
    Omit<ArbiterState, 'playing'> {
  now: NowPlaying
  toPart: (value: string) => void
  playBookmark: (item: AudioBookmarkItem) => void
  expanded: boolean
  setExpanded: (expanded: boolean) => void
  focusBookmarks: boolean
  setFocusBookmarks: (focus: boolean) => void
  readAloud: ReadAloudApi
  setSleep: (choice: SleepChoice) => void
}

const PlayerContext = createContext<PlayerApi | null>(null)

export function usePlayer(): PlayerApi {
  const api = useContext(PlayerContext)
  if (!api) throw new Error('usePlayer outside PlayerProvider')
  return api
}

export const PLAYER_HEIGHT = 74

const IDLE_ARBITER: ArbiterState = { sleep: SLEEP_OFF, sleepChoice: 'off', playing: false }

export function PlayerProvider({ children, signedIn = false }: { children: ReactNode; signedIn?: boolean }) {
  const toast = useToast()
  const audioRef = useRef<HTMLAudioElement>(null)
  const speechRef = useRef<HTMLAudioElement>(null)
  const transport = useRef<Transport | null>(null)
  const arbiter = useRef<Arbiter | null>(null)
  const lockScreen = useRef<LockScreen | null>(null)
  const [audio, setAudio] = useState(IDLE_TRANSPORT)
  const [arbitration, setArbitration] = useState(IDLE_ARBITER)
  const [expanded, setExpanded] = useState(false)
  const [focusBookmarks, setFocusBookmarks] = useState(false)

  const speech = useReadAloud(
    () => arbiter.current?.voiceSlept(),
    speechRef,
    signedIn,
    (notice: DownloadNotice) => toast(noticeMessage(notice)),
    (on) => arbiter.current?.playing('voice', on),
    () => arbiter.current?.closed(),
  )
  const latest = useRef({ speech, signedIn, toast })
  latest.current = { speech, signedIn, toast }

  useEffect(() => {
    if (!audioRef.current) return
    const voice = () => latest.current.speech
    const a = createArbiter({
      audiobook: {
        loaded: () => t.loaded(),
        close: () => {
          t.close()
          setExpanded(false)
        },
        pause: () => t.pause(),
        fadeOut: () => t.fadeOut(),
      },
      voice: {
        loaded: () => voice().book !== null,
        close: () => voice().close(),
        stopAfterSentence: () => voice().stopAfterSentence(),
        setStopAtChapterEnd: (on) => voice().setStopAtChapterEnd(on),
      },
      aside: voice().aside,
      onSleepEnded: () => latest.current.toast('Sleep timer ended'),
      onChange: setArbitration,
    })
    const t = createTransport({
      audio: audioRef.current as unknown as MediaLike,
      storage: browserStorage(),
      queue: (item) => syncOutbox.add(item),
      onBookFinished: (book) => void noteFinished(book.slug, book.title, latest.current),
      arbiter: a,
      onState: setAudio,
    })
    const lock = createLockScreen(navigator, {
      audiobook: t,
      voice: {
        toggle: () => voice().toggle(),
        prevSentence: () => voice().prevSentence(),
        nextSentence: () => voice().nextSentence(),
      },
    })
    arbiter.current = a
    transport.current = t
    lockScreen.current = lock
    setAudio(t.state())
    return () => {
      lock.dispose()
      t.dispose()
      a.dispose()
      arbiter.current = null
      transport.current = null
      lockScreen.current = null
    }
  }, [])

  const controls = useMemo(() => {
    const call =
      <K extends keyof Transport>(name: K) =>
      (...args: Parameters<Transport[K]>) =>
        (transport.current?.[name] as ((...a: Parameters<Transport[K]>) => void) | undefined)?.(...args)
    return {
      play: call('play'),
      playAt: call('playAt'),
      toggle: call('toggle'),
      seek: call('seek'),
      skip: call('skip'),
      prev: call('prev'),
      next: call('next'),
      cycleSpeed: call('cycleSpeed'),
      close: () => {
        transport.current?.close()
        arbiter.current?.closed()
        setExpanded(false)
      },
      setSleep: (choice: SleepChoice) => arbiter.current?.setSleep(choice),
    }
  }, [])

  const readAloud = useMemo<ReadAloudApi>(() => {
    const aside =
      <A extends unknown[]>(speak: (...args: A) => void) =>
      (...args: A) => {
        arbiter.current?.beforeAside()
        speak(...args)
      }
    return {
      ...speech,
      start: (book, at) => {
        arbiter.current?.beforeVoice()
        speech.start(book, at)
      },
      close: () => {
        speech.close()
        setExpanded(false)
      },
      aside: { ...speech.aside, hush: aside(speech.aside.hush), say: aside(speech.aside.say) },
    }
  }, [speech])

  const now = useMemo(() => nowPlaying(audio, speech), [audio, speech])

  useEffect(() => {
    readingTime.setListening(arbitration.playing)
  }, [arbitration.playing])

  useEffect(() => {
    if (!speech.book && speech.problem) toast(problemMessage(speech.problem))
  }, [speech.book, speech.problem, toast])

  useEffect(() => {
    document.documentElement.style.setProperty('--player-h', now.source ? `${PLAYER_HEIGHT}px` : '0px')
    if (!now.source) setExpanded(false)
  }, [now.source])

  useEffect(() => {
    lockScreen.current?.update(now)
  }, [now])

  const api = useMemo<PlayerApi>(
    () => ({
      ...audio,
      ...controls,
      now,
      toPart: (value) => {
        if (value === partsOf(now).current) return
        if (now.source === 'speech') {
          readAloud.setFollowing(true)
          readAloud.toChapter(Number(value))
        } else if (now.source === 'audio') controls.play(now.book, now.episodes, value)
      },
      playBookmark: (item) => {
        const target = bookmarkPlay(now, item)
        if (target?.kind === 'voice') {
          readAloud.start(target.book, target.at)
          readAloud.setFollowing(true)
        } else if (target && now.source === 'audio')
          controls.playAt(now.book, now.episodes, target.episodeId, target.positionMs)
      },
      expanded,
      setExpanded,
      focusBookmarks,
      setFocusBookmarks,
      readAloud,
      sleep: arbitration.sleep,
      sleepChoice: arbitration.sleepChoice,
    }),
    [audio, controls, now, expanded, focusBookmarks, readAloud, arbitration],
  )

  return (
    <PlayerContext.Provider value={api}>
      {children}
      {/* biome-ignore lint/a11y/useMediaCaption: spoken-word recordings from LibriVox ship without caption tracks. */}
      <audio ref={audioRef} preload="metadata" data-testid="audio-element" />
      {/* biome-ignore lint/a11y/useMediaCaption: read aloud's speech; the sentence it says is marked on the page. */}
      <audio ref={speechRef} preload="auto" data-testid="speech-element" />
    </PlayerContext.Provider>
  )
}
