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
  voice: { toggle: () => void; prevSentence: () => void; nextSentence: () => void }
}

export interface LockScreen {
  update: (now: NowPlaying) => void
  dispose: () => void
}

function metadataOf(title: string, { author, title: album, image, coverUrl: src }: PlayerBook): MediaMetadataInit {
  const ext = image && /\.(jpg|png|webp)$/.exec(image.src)?.[1]
  const type = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
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

type Screen = { source: 'audio' | 'speech'; metadata: MediaMetadataInit }

function screenOf(now: NowPlaying): Screen | null {
  if (now.source === 'audio') return { source: 'audio', metadata: metadataOf(now.episode.title, now.book) }
  if (now.source === 'speech' && now.engine !== 'device')
    return { source: 'speech', metadata: metadataOf(now.chapter?.title ?? now.book.title, now.book) }
  return null
}

export function createLockScreen(nav: { mediaSession?: MediaSessionLike }, actions: LockScreenActions): LockScreen {
  const ms = nav.mediaSession
  if (!ms) return { update: () => {}, dispose: () => {} }

  let metadataKey: string | null = null
  let handlersFor: Screen['source'] | null = null
  let voicePlaying = false

  const audiobook = actions.audiobook
  const voice = actions.voice
  const handlers: Record<Screen['source'], Handlers> = {
    audio: [
      ['play', () => audiobook.resume()],
      ['pause', () => audiobook.pause()],
      ['seekbackward', () => audiobook.skip(-15_000)],
      ['seekforward', () => audiobook.skip(15_000)],
      ['previoustrack', () => audiobook.prev()],
      ['nexttrack', () => audiobook.next()],
      ['seekto', (d) => d.seekTime !== undefined && audiobook.seekFile(d.seekTime * 1000)],
    ],
    speech: [
      ['play', () => !voicePlaying && voice.toggle()],
      ['pause', () => voicePlaying && voice.toggle()],
      ['previoustrack', () => voice.prevSentence()],
      ['nexttrack', () => voice.nextSentence()],
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
      voicePlaying = now.source === 'speech' && now.playing
      ms.playbackState = now.source === 'speech' ? (voicePlaying ? 'playing' : 'paused') : 'none'
    },
    dispose: reset,
  }
}
