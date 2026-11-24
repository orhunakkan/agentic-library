import type { AudioLike } from '~/client/features/read-aloud/audio-speaker'
import { browserTimers, type Timers } from '~/client/features/read-aloud/speaker'
import type { OutboxItem } from '~/client/features/sync/outbox'
import type { PlayerBook, PlayerEpisode } from '~/shared/content/book-page'
import { hasPrivateSlugPrefix } from '~/shared/content/book-slug'
import type { Arbiter } from './arbitration'
import { elementTime, endsInsideFile, isWindowed, needsSeek, reachedEnd, timeInEpisode } from './episode-window'
import { finishEpisode, readEpisode, readSpeed, writeEpisode, writeSpeed } from './position-store'
import { neighbours, nextSpeed } from './queue'

export interface MediaLike extends AudioLike {
  currentTime: number
  volume: number
  readonly paused: boolean
  getAttribute: (name: 'src') => string | null
  addEventListener: (
    type: 'playing' | 'ended' | 'error' | 'play' | 'pause' | 'timeupdate' | 'loadedmetadata',
    listener: () => void,
  ) => void
}

export interface TransportState {
  book: PlayerBook | null
  episodes: PlayerEpisode[]
  current: PlayerEpisode | null
  playing: boolean
  positionMs: number
  durationMs: number
  speed: number
  hasPrev: boolean
  hasNext: boolean
}

export interface TransportDeps {
  audio: MediaLike
  storage: Storage | null
  now?: () => number
  timers?: Timers
  queue: (item: OutboxItem) => void
  onBookFinished: (book: PlayerBook) => void
  arbiter: Pick<Arbiter, 'beforeAudiobook' | 'playing' | 'partEnded' | 'closed'>
  onState: (state: TransportState) => void
}

export interface Transport {
  play: (book: PlayerBook, episodes: PlayerEpisode[], episodeId: string) => void
  playAt: (book: PlayerBook, episodes: PlayerEpisode[], episodeId: string, ms: number) => void
  toggle: () => void
  resume: () => void
  pause: () => void
  seek: (ms: number) => void
  skip: (deltaMs: number) => void
  seekFile: (ms: number) => void
  prev: () => void
  next: () => void
  cycleSpeed: () => void
  fadeOut: () => void
  close: () => void
  loaded: () => boolean
  state: () => TransportState
  dispose: () => void
}

export const FADE_MS = 10_000
const FADE_STEP_MS = 250
const SAVE_EVERY_MS = 5000

function resumeAt(episode: PlayerEpisode, saved: number | null, startMs?: number): number | null {
  if (startMs !== undefined) return Math.max(0, Math.min(startMs, episode.durationMs))
  return saved && saved < episode.durationMs - 10_000 ? saved : null
}

const legacyUrl = (book: PlayerBook, episode: PlayerEpisode) =>
  hasPrivateSlugPrefix(book.slug) ? undefined : episode.audioUrl

export const IDLE_TRANSPORT: TransportState = {
  book: null,
  episodes: [],
  current: null,
  playing: false,
  positionMs: 0,
  durationMs: 0,
  speed: 1,
  hasPrev: false,
  hasNext: false,
}

export function createTransport(deps: TransportDeps): Transport {
  const { audio, storage } = deps
  const now = deps.now ?? Date.now
  const timers = deps.timers ?? browserTimers
  let s: Omit<TransportState, 'hasPrev' | 'hasNext'> = { ...IDLE_TRANSPORT, speed: readSpeed(storage) ?? 1 }
  let lastSaved = 0
  let ended: string | null = null
  let fade: { timer: unknown; volume: number } | null = null
  let disposed = false

  const state = (): TransportState => {
    const { prev, next } = s.current ? neighbours(s.episodes, s.current.id) : { prev: undefined, next: undefined }
    return { ...s, hasPrev: prev !== undefined, hasNext: next !== undefined }
  }
  const set = (patch: Partial<typeof s>) => {
    s = { ...s, ...patch }
    deps.onState(state())
  }
  const finished = () => s.current !== null && ended === s.current.id
  const windowOf = (current: PlayerEpisode) => ({ ...current, durationMs: s.durationMs || current.durationMs })

  const save = (book: PlayerBook, episode: PlayerEpisode, ms: number) => {
    const at = now()
    writeEpisode(storage, book.slug, episode.id, ms, at, legacyUrl(book, episode))
    deps.queue({ book: book.slug, kind: 'episode', episode: episode.id, positionMs: Math.max(0, Math.round(ms)), at })
  }
  const saveHere = () => {
    if (s.book && s.current && !finished()) save(s.book, s.current, timeInEpisode(audio.currentTime * 1000, s.current))
  }
  const finish = (book: PlayerBook, episode: PlayerEpisode) => {
    const at = now()
    finishEpisode(storage, book.slug, episode.id, at, legacyUrl(book, episode))
    deps.queue({ book: book.slug, kind: 'episode', episode: episode.id, positionMs: null, at })
  }

  const stopFade = () => {
    if (!fade) return
    timers.clearTimeout(fade.timer)
    audio.volume = fade.volume
    fade = null
  }

  const fadeOut = () => {
    stopFade()
    const volume = audio.volume
    const startedAt = now()
    const step = () => {
      const t = (now() - startedAt) / FADE_MS
      if (t >= 1) {
        audio.pause()
        stopFade()
        return
      }
      audio.volume = volume * (1 - t)
      if (fade) fade.timer = timers.setTimeout(step, FADE_STEP_MS)
    }
    fade = { volume, timer: timers.setTimeout(step, FADE_STEP_MS) }
  }

  const load = (book: PlayerBook, episodes: PlayerEpisode[], episode: PlayerEpisode, autoplay = true, at?: number) => {
    deps.arbiter.beforeAudiobook()
    stopFade()
    const resume = resumeAt(episode, readEpisode(storage, book.slug, episode.id, legacyUrl(book, episode)).ms, at) ?? 0
    const previous = s.current
    const sameFile = previous?.audioUrl === episode.audioUrl && audio.getAttribute('src') === episode.audioUrl
    ended = null
    set({ book, episodes, current: episode, positionMs: resume, durationMs: episode.durationMs })
    if (!sameFile) {
      audio.src = episode.audioUrl
      const start = elementTime(resume, episode)
      if (start) audio.currentTime = start / 1000
    } else if (needsSeek(audio.currentTime * 1000, previous, episode, resume))
      audio.currentTime = elementTime(resume, episode) / 1000
    audio.playbackRate = s.speed
    if (autoplay) audio.play().catch(refused)
    else if (sameFile) audio.pause()
  }

  const refused = () => {
    set({ playing: false })
    if (audio.paused) deps.arbiter.playing('audiobook', false)
  }

  const toggle = () => {
    if (!s.current) return
    stopFade()
    if (audio.paused) void audio.play().catch(() => {})
    else audio.pause()
  }

  const seek = (ms: number) => {
    if (!s.current) return
    const w = windowOf(s.current)
    const at = elementTime(ms, w)
    ended = null
    audio.currentTime = at / 1000
    set({ positionMs: timeInEpisode(at, w) })
  }

  const step = (direction: 'prev' | 'next', autoplay = true) => {
    if (!s.book || !s.current) return
    const target = neighbours(s.episodes, s.current.id)[direction]
    if (target) load(s.book, s.episodes, target, autoplay)
    else if (direction === 'prev') seek(0)
  }

  const episodeEnded = () => {
    const { book, current } = s
    if (!book || !current || finished()) return
    ended = current.id
    if (s.episodes.at(-1)?.id === current.id) deps.onBookFinished(book)
    const stop = deps.arbiter.partEnded() === 'stop'
    if (stop) audio.pause()
    finish(book, current)
    step('next', !stop)
  }

  const listen = (type: Parameters<MediaLike['addEventListener']>[0], listener: () => void) =>
    audio.addEventListener(type, () => {
      if (!disposed) listener()
    })
  listen('play', () => {
    set({ playing: true })
    deps.arbiter.playing('audiobook', true)
  })
  listen('pause', () => {
    saveHere()
    set({ playing: false })
    deps.arbiter.playing('audiobook', false)
  })
  listen('timeupdate', () => {
    const { book, current } = s
    if (!current) return
    const elementMs = audio.currentTime * 1000
    const ms = timeInEpisode(elementMs, current)
    set({ positionMs: ms })
    if (book && !finished() && Math.abs(ms - lastSaved) > SAVE_EVERY_MS) {
      lastSaved = ms
      save(book, current, ms)
    }
    if (endsInsideFile(s.episodes, current) && reachedEnd(elementMs, current)) episodeEnded()
  })
  listen('loadedmetadata', () => {
    const ms = audio.duration * 1000
    if (s.current && isWindowed(s.episodes, s.current)) return
    if (Number.isFinite(ms) && ms > 0) set({ durationMs: ms })
  })
  listen('ended', episodeEnded)

  return {
    play: (book, episodes, episodeId) => {
      if (s.current?.id === episodeId && s.book?.slug === book.slug) return toggle()
      const episode = episodes.find((e) => e.id === episodeId)
      if (episode) load(book, episodes, episode)
    },
    playAt: (book, episodes, episodeId, ms) => {
      const episode = episodes.find((e) => e.id === episodeId)
      if (!episode) return
      if (s.current?.id !== episodeId || s.book?.slug !== book.slug) return load(book, episodes, episode, true, ms)
      stopFade()
      seek(ms)
      void audio.play().catch(() => {})
    },
    toggle,
    resume: () => {
      if (s.current) void audio.play().catch(() => {})
    },
    pause: () => audio.pause(),
    seek,
    skip: (delta) => seek(s.positionMs + delta),
    seekFile: (ms) => {
      if (s.current) seek(timeInEpisode(ms, windowOf(s.current)))
    },
    prev: () => step('prev'),
    next: () => step('next'),
    cycleSpeed: () => {
      const speed = nextSpeed(s.speed)
      audio.playbackRate = speed
      writeSpeed(storage, speed)
      set({ speed })
    },
    fadeOut,
    close: () => {
      stopFade()
      const wasLoaded = s.current !== null
      if (wasLoaded) {
        saveHere()
        audio.pause()
        audio.removeAttribute('src')
        audio.load()
      }
      set({ book: null, episodes: [], current: null, playing: false, positionMs: 0 })
      if (wasLoaded) deps.arbiter.closed()
    },
    loaded: () => s.current !== null,
    state,
    dispose: () => {
      disposed = true
      stopFade()
    },
  }
}
