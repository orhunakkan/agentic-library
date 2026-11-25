import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useToast } from '~/client/components/Toast'
import type { AudioBookmarkItem } from '~/client/features/bookmarks/audio-bookmark-list'
import type { Aside } from '~/client/features/read-aloud/aside'
import { browserReadAloud } from '~/client/features/read-aloud/browser-read-aloud'
import type { ReadAloudState } from '~/client/features/read-aloud/controller'
import { noticeMessage, problemMessage } from '~/client/features/read-aloud/messages'
import { noteFinished } from '~/client/features/reading-stats/finish'
import { readingTime } from '~/client/features/reading-stats/reading-time'
import { syncOutbox } from '~/client/features/sync/outbox'
import { browserStorage } from '~/client/lib/storage-keys'
import { createLockScreen } from './media-session'
import type { NowPlaying } from './now-playing'
import { type AudiobookControls, createPlayer, type PlayerState, type ReadAloudControls } from './player'
import type { Sleep, SleepChoice } from './sleep'
import type { TransportState } from './transport'

export type ReadAloudApi = ReadAloudControls & ReadAloudState & { supported: boolean; aside: Aside }

interface PlayerApi extends TransportState, AudiobookControls {
  now: NowPlaying
  toPart: (value: string) => void
  playBookmark: (item: AudioBookmarkItem) => void
  expanded: boolean
  setExpanded: (expanded: boolean) => void
  focusBookmarks: boolean
  setFocusBookmarks: (focus: boolean) => void
  readAloud: ReadAloudApi
  sleep: Sleep
  sleepChoice: SleepChoice
  setSleep: (choice: SleepChoice) => void
}

const PlayerContext = createContext<PlayerApi | null>(null)

export function usePlayer(): PlayerApi {
  const api = useContext(PlayerContext)
  if (!api) throw new Error('usePlayer outside PlayerProvider')
  return api
}

export const PLAYER_HEIGHT = 74

export function PlayerProvider({ children, signedIn = false }: { children: ReactNode; signedIn?: boolean }) {
  const toast = useToast()
  const audioRef = useRef<HTMLAudioElement>(null)
  const speechRef = useRef<HTMLAudioElement>(null)
  const latest = useRef({ signedIn, toast })
  latest.current = { signedIn, toast }
  const [expanded, setExpanded] = useState(false)
  const [focusBookmarks, setFocusBookmarks] = useState(false)

  const [player] = useState(() =>
    createPlayer({
      storage: browserStorage(),
      queue: (item) => syncOutbox.add(item),
      signedIn,
      onBookFinished: (book) => void noteFinished(book.slug, book.title, latest.current),
      onSleepEnded: () => latest.current.toast('Sleep timer ended'),
      onNotice: (notice) => latest.current.toast(noticeMessage(notice)),
      lockScreen: (actions) => createLockScreen(navigator, actions),
    }),
  )
  const state: PlayerState = useSyncExternalStore(player.subscribe, player.state, player.state)

  useEffect(() => {
    if (!audioRef.current) return
    player.attach({
      audiobook: audioRef.current,
      readAloud: browserReadAloud(speechRef.current),
    })
    return () => player.detach()
  }, [player])

  useEffect(() => player.setSignedIn(signedIn), [player, signedIn])

  const { now, readAloud: reading, playing } = state

  useEffect(() => {
    readingTime.setListening(playing)
  }, [playing])

  useEffect(() => {
    if (!reading.book && reading.problem) toast(problemMessage(reading.problem))
  }, [reading.book, reading.problem, toast])

  useEffect(() => {
    document.documentElement.style.setProperty('--player-h', now.source ? `${PLAYER_HEIGHT}px` : '0px')
    if (!now.source) setExpanded(false)
  }, [now.source])

  const readAloud = useMemo<ReadAloudApi>(
    () => ({ ...reading, ...player.readAloud, supported: state.readAloudSupported, aside: player.aside }),
    [reading, player, state.readAloudSupported],
  )

  const api = useMemo<PlayerApi>(
    () => ({
      ...state.audiobook,
      ...player.audiobook,
      now,
      toPart: player.toPart,
      playBookmark: player.playBookmark,
      expanded,
      setExpanded,
      focusBookmarks,
      setFocusBookmarks,
      readAloud,
      sleep: state.sleep,
      sleepChoice: state.sleepChoice,
      setSleep: player.setSleep,
    }),
    [state.audiobook, state.sleep, state.sleepChoice, player, now, expanded, focusBookmarks, readAloud],
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
