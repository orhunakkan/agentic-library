import type { SpeakErrorCode, SpeakIntro, SpeakSpan } from '~/shared/read-aloud/cloud'

export interface UtteranceLike {
  text: string
  lang: string
  rate: number
  voice: SpeechSynthesisVoice | null
  onstart: ((event: unknown) => void) | null
  onend: ((event: unknown) => void) | null
  onerror: ((event: { error?: string }) => void) | null
}

export interface SynthLike {
  speak: (utterance: never) => void
  cancel: () => void
}

export interface Timers {
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (id: unknown) => void
}

/** Where an utterance is in a book: a span of a page, or a chapter's intro. A cloud voice is asked for it by this. */
export type SpeakRef = Omit<SpeakSpan, 'voice' | 'format'> | Omit<SpeakIntro, 'voice' | 'format'>

/** Something read aloud will say: its text, where it is in the book, or both. */
export interface Utterance {
  text?: string
  ref?: SpeakRef
}

export interface SpeakOptions {
  lang: string
  rate: number
  voice: SpeechSynthesisVoice | null
  /** Where in the book the text being spoken is, when it is in one. */
  ref?: SpeakRef
  /** The cloud model to speak with, when the reader has one. */
  model?: string
  /** What read aloud will say next, nearest first, so a speaker can make it ahead. */
  ahead: Utterance[]
}

export type CloudProblemCode = Exclude<SpeakErrorCode, 'invalid' | 'not_found' | 'failed'>

export type LocalProblemCode = 'local_missing' | 'local_failed'

/**
 * Why a speaker couldn't say an utterance. `failed` is a passing error, worth trying the next one.
 * `blocked` is the browser refusing to play until the reader presses, whichever voice was speaking.
 */
export type SpeakProblem =
  | { kind: 'cloud'; code: CloudProblemCode; retryAt?: Date }
  | { kind: 'local'; code: LocalProblemCode }
  | { kind: 'blocked' }
  | { kind: 'not-found' }
  | { kind: 'failed' }

export const FAILED: SpeakProblem = { kind: 'failed' }

export interface SpeakHandlers {
  onStart?: () => void
  onEnd: () => void
  onError: (problem: SpeakProblem) => void
}

export interface Speaker {
  speak: (text: string, options: SpeakOptions, handlers: SpeakHandlers) => void
  stop: () => void
  /** Readies playback inside the reader's press, so a later utterance may play. Safe to call on every speaker. */
  prime: () => void
  /** Stops and lets go of everything the speaker holds. */
  close: () => void
}

export const watchdogMs = (text: string, rate: number) => Math.round((text.length / (8 * rate) + 5) * 1000)

export const browserTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
}

export function createSpeaker(
  synth: SynthLike,
  makeUtterance: (text: string) => UtteranceLike,
  timers: Timers = browserTimers,
): Speaker {
  let current: { utterance: UtteranceLike; watchdog: unknown } | null = null

  const finish = (utterance: UtteranceLike): boolean => {
    if (current?.utterance !== utterance) return false
    timers.clearTimeout(current.watchdog)
    current = null
    return true
  }

  const stop = () => {
    if (current) {
      timers.clearTimeout(current.watchdog)
      current = null
    }
    synth.cancel()
  }

  const speak = (text: string, options: SpeakOptions, handlers: SpeakHandlers) => {
    stop()
    const utterance = makeUtterance(text)
    utterance.lang = options.lang
    utterance.rate = options.rate
    utterance.voice = options.voice
    utterance.onstart = () => {
      if (current?.utterance === utterance) handlers.onStart?.()
    }
    utterance.onend = () => {
      if (finish(utterance)) handlers.onEnd()
    }
    utterance.onerror = () => {
      if (finish(utterance)) handlers.onError(FAILED)
    }
    const watchdog = timers.setTimeout(
      () => {
        if (!finish(utterance)) return
        synth.cancel()
        handlers.onError(FAILED)
      },
      watchdogMs(text, options.rate),
    )
    current = { utterance, watchdog }
    synth.speak(utterance as never)
  }

  return { speak, stop, prime: () => {}, close: () => {} }
}
