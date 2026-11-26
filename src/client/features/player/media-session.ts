import type { PlayerBook } from '~/shared/content/book-page'
import type { NowPlaying } from './now-playing'

export interface MediaSessionLike {
  metadata: MediaMetadata | null
  playbackState: MediaSessionPlaybackState
  setActionHandler: (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => void
}

export interface LockScreenActions {
  audiobook: {
    resume: () => void
    pause: () => void
    skip: (ms: number) => void
    prev: () => void
    next: () => void
    seekFile: (ms: number) => void
  }
  readAloud: { toggle: () => void; prevSentence: () => void; nextSentence: () => void }
}

export interface LockScreen {
  update: (now: NowPlaying) => void
  dispose: () => void
}

function metadataOf(title: string, { author, title: album, image, coverUrl: src }: PlayerBook): MediaMetadataInit {
  const ext = image && /\.(jpg|png|webp)$/.exec(image.src)?.[1]
  const type = ext === 'png' || ext === 'webp' ? `image/${ext}` : 'image/jpeg'
  const artwork = [
    image ? { src, sizes: `${image.width}x${image.height}`, type } : { src, sizes: '600x900', type: 'image/svg+xml' },
  ]
  return { title, artist: author, album, artwork }
}

const ALL_ACTIONS: MediaSessionAction[] = [
  'play',
  'pause',
  'seekbackward',
  'seekforward',
  'previoustrack',
  'nexttrack',
  'seekto',
]

type Handlers = [MediaSessionAction, MediaSessionActionHandler | null][]

type Screen = { source: NonNullable<NowPlaying['source']>; metadata: MediaMetadataInit }

function screenOf(now: NowPlaying): Screen | null {
  if (now.source === 'audiobook') return { source: 'audiobook', metadata: metadataOf(now.episode.title, now.book) }
  if (now.source === 'read-aloud' && now.engine !== 'device')
    return { source: 'read-aloud', metadata: metadataOf(now.chapter?.title ?? now.book.title, now.book) }
  return null
}

function playbackStateOf(now: NowPlaying): MediaSessionPlaybackState {
  if (now.source !== 'read-aloud') return 'none'
  return now.playing ? 'playing' : 'paused'
}

export function createLockScreen(nav: { mediaSession?: MediaSessionLike }, actions: LockScreenActions): LockScreen {
  const ms = nav.mediaSession
  if (!ms) return { update: () => {}, dispose: () => {} }

  let metadataKey: string | null = null
  let handlersFor: Screen['source'] | null = null
  let readAloudPlaying = false

  const audiobook = actions.audiobook
  const readAloud = actions.readAloud
  const handlers: Record<Screen['source'], Handlers> = {
    audiobook: [
      ['play', () => audiobook.resume()],
      ['pause', () => audiobook.pause()],
      ['seekbackward', () => audiobook.skip(-15_000)],
      ['seekforward', () => audiobook.skip(15_000)],
      ['previoustrack', () => audiobook.prev()],
      ['nexttrack', () => audiobook.next()],
      ['seekto', (d) => d.seekTime !== undefined && audiobook.seekFile(d.seekTime * 1000)],
    ],
    'read-aloud': [
      ['play', () => !readAloudPlaying && readAloud.toggle()],
      ['pause', () => readAloudPlaying && readAloud.toggle()],
      ['previoustrack', () => readAloud.prevSentence()],
      ['nexttrack', () => readAloud.nextSentence()],
      ['seekbackward', null],
      ['seekforward', null],
      ['seekto', null],
    ],
  }

  const setHandlers = (list: Handlers) => {
    for (const [action, handler] of list) {
      try {
        ms.setActionHandler(action, handler)
      } catch {}
    }
  }

  const reset = () => {
    if (handlersFor !== null) {
      ms.metadata = null
      ms.playbackState = 'none'
      setHandlers(ALL_ACTIONS.map((action) => [action, null]))
    }
    metadataKey = handlersFor = null
  }

  return {
    update: (now) => {
      const screen = screenOf(now)
      if (!screen) return reset()
      const key = JSON.stringify(screen.metadata)
      if (key !== metadataKey) {
        ms.metadata = new MediaMetadata(screen.metadata)
        metadataKey = key
      }
      if (handlersFor !== screen.source) {
        setHandlers(handlers[screen.source])
        handlersFor = screen.source
      }
      readAloudPlaying = now.source === 'read-aloud' && now.playing
      ms.playbackState = playbackStateOf(now)
    },
    dispose: reset,
  }
}
