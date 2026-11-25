import { type Aside, type AsideDeps, createAside, forwardAside } from '~/client/features/read-aloud/aside'
import {
  type ControllerDeps,
  closedState,
  createReadAloud,
  type ReadAloud,
  type ReadAloudState,
} from '~/client/features/read-aloud/controller'
import type { DownloadNotice } from '~/client/features/read-aloud/messages'
import { voiceItem } from '~/client/features/read-aloud/position-store'
import type { OutboxItem } from '~/client/features/sync/outbox'
import type { AudioBookmarkView } from '~/shared/bookmarks/audio'
import { createArbiter } from './arbitration'
import type { LockScreen, LockScreenActions } from './media-session'
import { bookmarkPlay, type NowPlaying, nowPlaying, partsOf } from './now-playing'
import type { Sleep, SleepChoice } from './sleep'
import { createTransport, IDLE_TRANSPORT, type MediaLike, type Transport, type TransportState } from './transport'

/** What a browser gives read aloud to speak with; the player adds the rest. */
export interface ReadAloudParts {
  controller: Omit<ControllerDeps, 'onState' | 'arbiter' | 'storage' | 'now' | 'onSaved' | 'onNotice'>
  aside: Omit<AsideDeps, 'pauseBook' | 'storage'>
  dispose: () => void
}

/** Builds read aloud for whoever is signed in, or null where the browser can't speak. */
export type ReadAloudFactory = (signedIn: boolean, hooks: { onSlow: () => void }) => ReadAloudParts | null

export interface PlayerDeps {
  storage: Storage | null
  queue: (item: OutboxItem) => void
  signedIn: boolean
  onBookFinished: (book: { slug: string; title: string }) => void
  onSleepEnded: () => void
  onNotice: (notice: DownloadNotice) => void
  lockScreen?: (actions: LockScreenActions) => LockScreen
}

export interface PlayerState {
  audiobook: TransportState
  readAloud: ReadAloudState
  readAloudSupported: boolean
  now: NowPlaying
  sleep: Sleep
  sleepChoice: SleepChoice
  playing: boolean
}

export type ReadAloudControls = Omit<ReadAloud, 'state'>

export interface Player {
  subscribe: (listener: () => void) => () => void
  state: () => PlayerState
  /** Starts playing through the page's media elements; `detach` lets them go. */
  attach: (media: { audiobook: MediaLike; readAloud: ReadAloudFactory }) => void
  detach: () => void
  /** Signing in or out builds read aloud again, closing the book it was reading. */
  setSignedIn: (signedIn: boolean) => void
  audiobook: AudiobookControls
  readAloud: ReadAloudControls
  aside: Aside
  setSleep: (choice: SleepChoice) => void
  toPart: (value: string) => void
  playBookmark: (item: AudioBookmarkView) => void
}

const AUDIOBOOK_ACTIONS = [
  'play',
  'playAt',
  'toggle',
  'seek',
  'skip',
  'prev',
  'next',
  'cycleSpeed',
  'close',
] as const satisfies readonly (keyof Transport)[]

export type AudiobookControls = Pick<Transport, (typeof AUDIOBOOK_ACTIONS)[number]>

const READ_ALOUD_ACTIONS = [
  'start',
  'toggle',
  'pause',
  'nextSentence',
  'prevSentence',
  'nextChapter',
  'prevChapter',
  'toChapter',
  'seekFraction',
  'setRate',
  'setVoice',
  'useDeviceVoice',
  'retryCloudVoices',
  'downloadLocal',
  'cancelDownload',
  'removeLocal',
  'dismissOffer',
  'noteSlow',
  'setFollowing',
  'stopAfterSentence',
  'retry',
  'close',
] as const satisfies readonly (keyof ReadAloudControls)[]

/** Fails to compile when a read-aloud control is left off its list. */
const covered: Exclude<keyof ReadAloudControls, (typeof READ_ALOUD_ACTIONS)[number]> extends never ? true : never = true
void covered

/** Each control calls through to whatever the getter returns at the time, doing nothing while it returns null. */
function forward<T, const K extends keyof T>(names: readonly K[], get: () => T | null): Pick<T, K> {
  return Object.fromEntries(
    names.map((name) => [
      name,
      (...args: unknown[]) => (get()?.[name] as ((...a: unknown[]) => void) | undefined)?.(...args),
    ]),
  ) as Pick<T, K>
}

export function createPlayer(deps: PlayerDeps): Player {
  const listeners = new Set<() => void>()
  let signedIn = deps.signedIn
  let factory: ReadAloudFactory | null = null
  let transport: Transport | null = null
  let lockScreen: LockScreen | null = null
  let reading: { controller: ReadAloud; aside: Aside; dispose: () => void } | null = null
  let audiobookState = IDLE_TRANSPORT
  let readAloudState = closedState(1)
  let now: NowPlaying = { source: null }

  const arbiter = createArbiter({
    audiobook: {
      loaded: () => transport?.loaded() ?? false,
      close: () => transport?.close(),
      pause: () => transport?.pause(),
      fadeOut: () => transport?.fadeOut(),
    },
    readAloud: {
      loaded: () => reading?.controller.state().book != null,
      close: () => reading?.controller.close(),
      pause: () => reading?.controller.pause(),
      stopAfterSentence: () => reading?.controller.stopAfterSentence(),
    },
    aside: { interrupt: () => reading?.aside.interrupt() },
    onSleepEnded: () => deps.onSleepEnded(),
    onChange: () => changed(),
  })

  const snapshotOf = (): PlayerState => ({
    ...arbiter.state(),
    audiobook: audiobookState,
    readAloud: readAloudState,
    readAloudSupported: reading !== null,
    now,
  })
  let snapshot = snapshotOf()

  /** Tells subscribers; `sourceState` when a source's own state moved, so now playing and the lock screen follow. */
  function changed(sourceState = false) {
    if (sourceState) {
      now = nowPlaying(audiobookState, readAloudState)
      lockScreen?.update(now)
    }
    snapshot = snapshotOf()
    for (const listener of listeners) listener()
  }

  const stopReading = () => {
    const current = reading
    if (!current) return
    current.aside.stop()
    current.controller.close()
    reading = null
    current.dispose()
    readAloudState = closedState(readAloudState.rate)
    changed(true)
  }

  const startReading = () => {
    stopReading()
    if (!factory) return
    const parts = factory(signedIn, { onSlow: () => reading?.controller.noteSlow() })
    if (!parts) return
    const controller = createReadAloud({
      ...parts.controller,
      storage: deps.storage,
      arbiter,
      onState: (next) => {
        readAloudState = next
        changed(true)
      },
      onSaved: (book, saved) => {
        deps.queue(voiceItem(deps.storage, book, saved, Date.now()))
        if (saved === null) deps.onBookFinished({ slug: book, title: controller.state().book?.title ?? book })
      },
      onNotice: deps.onNotice,
    })
    const aside = createAside({ ...parts.aside, storage: deps.storage, pauseBook: () => arbiter.beforeAside() })
    reading = { controller, aside, dispose: parts.dispose }
    readAloudState = controller.state()
    changed(true)
  }

  const audiobook = forward(AUDIOBOOK_ACTIONS, () => transport)
  const readAloud = forward(READ_ALOUD_ACTIONS, () => reading?.controller ?? null)

  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    state: () => snapshot,
    attach: (media) => {
      transport = createTransport({
        audio: media.audiobook,
        storage: deps.storage,
        queue: deps.queue,
        onBookFinished: deps.onBookFinished,
        arbiter,
        onState: (next) => {
          audiobookState = next
          changed(true)
        },
      })
      audiobookState = transport.state()
      lockScreen = deps.lockScreen?.({ audiobook: transport, readAloud }) ?? null
      factory = media.readAloud
      startReading()
    },
    detach: () => {
      lockScreen?.dispose()
      lockScreen = null
      factory = null
      stopReading()
      transport?.dispose()
      transport = null
      audiobookState = IDLE_TRANSPORT
      arbiter.playing('audiobook', false)
      changed(true)
    },
    setSignedIn: (next) => {
      if (next === signedIn) return
      signedIn = next
      startReading()
    },
    audiobook,
    readAloud,
    aside: forwardAside(() => reading?.aside ?? null),
    setSleep: (choice) => arbiter.setSleep(choice),
    toPart: (value) => {
      if (value === partsOf(now).current) return
      if (now.source === 'read-aloud') {
        readAloud.setFollowing(true)
        readAloud.toChapter(Number(value))
      } else if (now.source === 'audiobook') audiobook.play(now.book, now.episodes, value)
    },
    playBookmark: (item) => {
      const target = bookmarkPlay(now, item)
      if (target?.source === 'read-aloud') readAloud.start(target.book, target.at)
      else if (target?.source === 'audiobook' && now.source === 'audiobook')
        audiobook.playAt(now.book, now.episodes, target.episodeId, target.positionMs)
    },
  }
}
