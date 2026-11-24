import { positionKey } from '~/shared/content/position'
import type { SpeakErrorCode, SpeakRequest, SpeechFormat, SpokenWord } from '~/shared/read-aloud/cloud'
import {
  type AudioLike,
  browserFrames,
  browserUrls,
  createAudioSpeaker,
  END_SLACK_MS,
  type Frames,
  type ObjectUrls,
  START_WATCHDOG_MS,
  UrlCache,
} from './audio-speaker'
import {
  browserTimers,
  FAILED,
  type Speaker,
  type SpeakHandlers,
  type SpeakOptions,
  type SpeakProblem,
  type SpeakRef,
  type Timers,
} from './speaker'
import type { SpeakResult } from './speech-client'

export type { AudioLike }
export { END_SLACK_MS, START_WATCHDOG_MS }

export interface CloudSpeakerDeps {
  audio: AudioLike
  speak: (request: SpeakRequest, signal: AbortSignal) => Promise<SpeakResult>
  onWord: (span: { start: number; end: number } | null) => void
  urls?: ObjectUrls
  timers?: Timers
  frames?: Frames
}

export const CACHE_SIZE = 40
export const MAX_IN_FLIGHT = 2
export const BUSY_RETRY_MS = 1000

export const CLOUD_VOICE_PREFIX = 'elevenlabs:'

const refKey = (ref: SpeakRef) => {
  if ('intro' in ref) return `${ref.book}|${ref.chapter}|intro`
  return `${ref.book}|${ref.chapter}|${positionKey(ref.position)}:${ref.start}-${ref.end}`
}

const problemOf = (code: SpeakErrorCode, retryAt?: Date): SpeakProblem => {
  if (code === 'not_found') return { kind: 'not-found' }
  if (code === 'invalid' || code === 'failed') return FAILED
  return retryAt ? { kind: 'cloud', code, retryAt } : { kind: 'cloud', code }
}

interface Entry {
  result: Promise<SpeakResult>
  controller: AbortController | null
  url: string | null
}

export function createCloudSpeaker(deps: CloudSpeakerDeps): Speaker {
  const { audio } = deps
  const urls = deps.urls ?? browserUrls
  const timers = deps.timers ?? browserTimers
  const frames = deps.frames ?? browserFrames
  const element = createAudioSpeaker(audio, timers)
  const cache = new UrlCache<Entry>(CACHE_SIZE, (entry) => {
    entry.controller?.abort()
    if (entry.url) urls.revoke(entry.url)
  })
  let format: SpeechFormat = 'low'

  const inFlight = () => cache.values().filter((e) => e.controller !== null)

  const fetchEntry = (key: string, request: SpeakRequest): Entry => {
    const controller = new AbortController()
    const entry: Entry = { result: Promise.resolve({ ok: false, problem: 'failed' }), controller, url: null }
    entry.result = (async () => {
      let result = await deps.speak(request, controller.signal)
      if (!result.ok && result.problem === 'busy' && !controller.signal.aborted) {
        await new Promise((resolve) => timers.setTimeout(() => resolve(null), BUSY_RETRY_MS))
        if (!controller.signal.aborted) result = await deps.speak(request, controller.signal)
      }
      entry.controller = null
      if (result.ok) {
        if (result.format === 'standard') format = 'standard'
        if (cache.peek(key) === entry) entry.url = urls.create(result.audio)
      } else if (cache.peek(key) === entry) cache.delete(key)
      return result
    })()
    cache.set(key, entry)
    return entry
  }

  const entryFor = (ref: SpeakRef, voice: string, model: string, force: boolean): Entry | null => {
    const key = `${voice}|${model}|${refKey(ref)}`
    const found = cache.get(key)
    if (found) return found
    const busy = inFlight()
    if (busy.length >= MAX_IN_FLIGHT) {
      if (!force) return null
      const [oldest] = busy
      oldest?.controller?.abort()
      if (oldest) cache.deleteValue(oldest)
    }
    return fetchEntry(key, { ...ref, voice, format } as SpeakRequest)
  }

  const speak = (_text: string, options: SpeakOptions, handlers: SpeakHandlers) => {
    element.stop()
    const { ref, model = '' } = options
    const voice = options.voice?.voiceURI.startsWith(CLOUD_VOICE_PREFIX)
      ? options.voice.voiceURI.slice(CLOUD_VOICE_PREFIX.length)
      : null
    if (!ref || !voice) {
      handlers.onError(FAILED)
      return
    }
    const words: { list: SpokenWord[]; frame: unknown; word: SpokenWord | null } = { list: [], frame: null, word: null }
    const track = () => {
      if (!element.isCurrent(turn)) return
      const t = audio.currentTime * 1000
      const word = words.list.findLast((w) => w.t0 <= t) ?? null
      const said = word && t < word.t1 + 250 ? word : null
      if (said !== words.word) {
        words.word = said
        deps.onWord(said && { start: said.start, end: said.end })
      }
      words.frame = frames.request(track)
    }
    const turn = element.begin(handlers, options.rate, {
      onPlaying: () => {
        if (words.list.length) track()
      },
      onClear: () => {
        if (words.frame !== null) frames.cancel(words.frame)
        if (words.word) deps.onWord(null)
      },
    })
    const entry = entryFor(ref, voice, model, true) as Entry
    void entry.result.then((result) => {
      if (!element.isCurrent(turn)) return
      if (!result.ok || !entry.url) {
        element.fail(turn, result.ok ? FAILED : problemOf(result.problem, result.retryAt))
        return
      }
      const upcoming = options.ahead[0]?.ref
      if (upcoming) entryFor(upcoming, voice, model, false)
      words.list = result.words
      element.play(turn, entry.url)
    })
  }

  return {
    speak,
    stop: element.stop,
    prime: element.prime,
    close: () => {
      element.stop()
      cache.clear()
      format = 'low'
      audio.removeAttribute('src')
      audio.load()
    },
  }
}
