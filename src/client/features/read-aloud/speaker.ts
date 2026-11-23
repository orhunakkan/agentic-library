import type { CloudSpeakOptions } from './cloud-speaker'

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

export interface SpeakOptions {
  lang: string
  rate: number
  voice: SpeechSynthesisVoice | null
  cloud?: CloudSpeakOptions
  local?: { upcoming: string[] }
}

export interface SpeakHandlers {
  onStart?: () => void
  onEnd: () => void
  onError: (error: string, retryAt?: Date) => void
}

export interface Speaker {
  speak: (text: string, options: SpeakOptions, handlers: SpeakHandlers) => void
  stop: () => void
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
    utterance.onerror = (event) => {
      if (finish(utterance)) handlers.onError(event?.error ?? 'unknown')
    }
    const watchdog = timers.setTimeout(
      () => {
        if (!finish(utterance)) return
        synth.cancel()
        handlers.onError('timeout')
      },
      watchdogMs(text, options.rate),
    )
    current = { utterance, watchdog }
    synth.speak(utterance as never)
  }

  return { speak, stop }
}
