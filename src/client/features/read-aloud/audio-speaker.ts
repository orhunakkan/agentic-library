import { writeWavHeader } from './piper/wav'
import { browserTimers, FAILED, type SpeakHandlers, type SpeakProblem, type Timers } from './speaker'

export interface AudioLike {
  src: string
  playbackRate: number
  preservesPitch: boolean
  readonly currentTime: number
  readonly duration: number
  play: () => Promise<void>
  pause: () => void
  removeAttribute: (name: string) => void
  load: () => void
  addEventListener: (type: 'playing' | 'ended' | 'error', listener: () => void) => void
}

export interface Frames {
  request: (fn: () => void) => unknown
  cancel: (id: unknown) => void
}

export const START_WATCHDOG_MS = 30_000
export const END_SLACK_MS = 5000

function silentWavUrl(): string {
  const samples = 800
  const bytes = new Uint8Array(44 + samples)
  writeWavHeader(bytes, 8000, 8, samples)
  bytes.fill(128, 44)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return `data:audio/wav;base64,${btoa(binary)}`
}

let silence: string | null = null

/**
 * Elements already primed in the running task. The speakers built on one element are all primed in
 * the same press, and a second `play()` there would restart the silence and abort the first.
 */
const primedThisTask = new WeakSet<AudioLike>()

export interface ObjectUrls {
  create: (blob: Blob) => string
  revoke: (url: string) => void
}

export const browserUrls: ObjectUrls = {
  create: (blob) => URL.createObjectURL(blob),
  revoke: (url) => URL.revokeObjectURL(url),
}

export const browserFrames: Frames = {
  request: (fn) => globalThis.requestAnimationFrame(fn),
  cancel: (id) => globalThis.cancelAnimationFrame(id as number),
}

export interface TurnHooks {
  onPlaying?: () => void
  onClear?: () => void
}

export interface Turn {
  readonly handlers: SpeakHandlers
  readonly rate: number
}

interface TurnState extends Turn {
  hooks: TurnHooks
  started: boolean
  watchdog: unknown
}

export interface AudioSpeaker {
  begin: (handlers: SpeakHandlers, rate: number, hooks?: TurnHooks) => Turn
  isCurrent: (turn: Turn) => boolean
  play: (turn: Turn, url: string) => void
  fail: (turn: Turn, problem: SpeakProblem) => void
  stop: () => void
  prime: () => void
  release: () => void
}

export function createAudioSpeaker(audio: AudioLike, timers: Timers = browserTimers): AudioSpeaker {
  let current: TurnState | null = null

  const clearCurrent = () => {
    if (!current) return
    const { hooks, watchdog } = current
    timers.clearTimeout(watchdog)
    current = null
    hooks.onClear?.()
  }

  const finish = (mine: TurnState, problem: SpeakProblem | null) => {
    if (current !== mine) return
    const { handlers } = mine
    clearCurrent()
    if (problem) handlers.onError(problem)
    else handlers.onEnd()
  }

  const timeOut = (mine: TurnState) => {
    audio.pause()
    finish(mine, FAILED)
  }

  audio.addEventListener('playing', () => {
    const mine = current
    if (!mine || mine.started || !audio.src || audio.src === silence) return
    mine.started = true
    const duration = audio.duration
    if (Number.isFinite(duration) && duration > 0) {
      timers.clearTimeout(mine.watchdog)
      mine.watchdog = timers.setTimeout(() => timeOut(mine), Math.round((duration / mine.rate) * 1000 + END_SLACK_MS))
    }
    mine.handlers.onStart?.()
    mine.hooks.onPlaying?.()
  })
  audio.addEventListener('ended', () => {
    if (current?.started) finish(current, null)
  })
  audio.addEventListener('error', () => {
    if (current && audio.src && audio.src !== silence) finish(current, FAILED)
  })

  const stop = () => {
    clearCurrent()
    audio.pause()
  }

  const state = (turn: Turn) => (current === turn ? current : null)

  return {
    begin: (handlers, rate, hooks = {}) => {
      stop()
      const mine: TurnState = { handlers, rate, hooks, started: false, watchdog: null }
      current = mine
      mine.watchdog = timers.setTimeout(() => timeOut(mine), START_WATCHDOG_MS)
      return mine
    },
    isCurrent: (turn) => current === turn,
    play: (turn, url) => {
      const mine = state(turn)
      if (!mine) return
      audio.src = url
      audio.preservesPitch = true
      audio.playbackRate = mine.rate
      audio.play().catch((error: unknown) => {
        if (current !== mine) return
        const blocked = (error as { name?: unknown } | null)?.name === 'NotAllowedError'
        finish(mine, blocked ? { kind: 'blocked' } : FAILED)
      })
    },
    fail: (turn, problem) => {
      const mine = state(turn)
      if (mine) finish(mine, problem)
    },
    stop,
    prime: () => {
      if (primedThisTask.has(audio)) return
      primedThisTask.add(audio)
      queueMicrotask(() => primedThisTask.delete(audio))
      silence ??= silentWavUrl()
      audio.src = silence
      audio.play().catch(() => {})
    },
    release: () => {
      stop()
      audio.removeAttribute('src')
      audio.load()
    },
  }
}

export class UrlCache<V> {
  readonly #entries = new Map<string, V>()
  constructor(
    private readonly size: number,
    private readonly onDrop: (value: V) => void,
  ) {}

  get(key: string): V | undefined {
    const found = this.#entries.get(key)
    if (found === undefined) return undefined
    this.#entries.delete(key)
    this.#entries.set(key, found)
    return found
  }
  peek(key: string): V | undefined {
    return this.#entries.get(key)
  }
  set(key: string, value: V): void {
    this.#entries.delete(key)
    this.#entries.set(key, value)
    while (this.#entries.size > this.size) {
      const [oldest, dropped] = this.#entries.entries().next().value as [string, V]
      this.#entries.delete(oldest)
      this.onDrop(dropped)
    }
  }
  delete(key: string): void {
    this.#entries.delete(key)
  }
  deleteValue(value: V): void {
    for (const [k, v] of this.#entries) if (v === value) this.#entries.delete(k)
  }
  values(): V[] {
    return [...this.#entries.values()]
  }
  clear(): void {
    for (const value of this.#entries.values()) this.onDrop(value)
    this.#entries.clear()
  }
  get length(): number {
    return this.#entries.size
  }
}
