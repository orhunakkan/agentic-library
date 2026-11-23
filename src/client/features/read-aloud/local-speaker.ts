import { folioVoice, voiceUrl } from '~/shared/read-aloud/folio-voices'
import { type AudioLike, browserUrls, createAudioSpeaker, type ObjectUrls, UrlCache } from './audio-speaker'
import { type Engine, EngineError, type Made } from './piper/engine'
import type { WorkerVoice } from './piper/protocol'
import type { Speaker, SpeakHandlers, SpeakOptions, Timers } from './speaker'

export const LOCAL_VOICE_PREFIX = 'folio:'

export const LOCAL_CACHE_SIZE = 20
export const AHEAD = 2
export const SLOW_RUN = 3

export interface LocalSpeakerDeps {
  audio: AudioLike
  engine: Engine
  onSlow?: () => void
  urls?: ObjectUrls
  timers?: Timers
}

export interface LocalSpeaker extends Speaker {
  prime: () => void
  close: () => void
}

export function workerVoice(voiceURI: string | undefined): WorkerVoice | null {
  const voice = voiceURI?.startsWith(LOCAL_VOICE_PREFIX) ? folioVoice(voiceURI.slice(LOCAL_VOICE_PREFIX.length)) : null
  return (
    voice && {
      id: voice.id,
      model: voiceUrl(voice.files.onnx, voice.id),
      config: voiceUrl(voice.files.config, voice.id),
    }
  )
}

export function wavDurationMs(wav: ArrayBuffer): number {
  if (wav.byteLength < 44) return 0
  const view = new DataView(wav)
  const rate = view.getUint32(24, true)
  return rate > 0 ? ((wav.byteLength - 44) / 2 / rate) * 1000 : 0
}

interface Entry {
  job: string
  result: Promise<Made>
  url: string | null
  counted: boolean
}

const PROBLEMS = new Set(['local_missing', 'local_failed'])

export function createLocalSpeaker(deps: LocalSpeakerDeps): LocalSpeaker {
  const urls = deps.urls ?? browserUrls
  const element = createAudioSpeaker(deps.audio, deps.timers)
  const cache = new UrlCache<Entry>(LOCAL_CACHE_SIZE, (entry) => {
    if (entry.url) urls.revoke(entry.url)
  })
  let jobs = 0
  let slowRun = 0
  let slowSaid = false

  const pending = () => cache.values().filter((e) => e.url === null)

  const entryFor = (voice: string, text: string): Entry => {
    const key = `${voice}|${text}`
    const found = cache.get(key)
    if (found) return found
    const job = `u${++jobs}`
    const entry: Entry = { job, result: deps.engine.synth(job, text), url: null, counted: false }
    entry.result.then(
      (made) => {
        if (cache.peek(key) === entry) entry.url = urls.create(new Blob([made.wav], { type: 'audio/wav' }))
      },
      () => {
        if (cache.peek(key) === entry) cache.delete(key)
      },
    )
    cache.set(key, entry)
    return entry
  }

  const count = (entry: Entry, made: Made, rate: number) => {
    if (entry.counted) return
    entry.counted = true
    const plays = wavDurationMs(made.wav) / rate
    slowRun = made.ms > plays ? slowRun + 1 : 0
    if (slowRun >= SLOW_RUN && !slowSaid) {
      slowSaid = true
      deps.onSlow?.()
    }
  }

  const dropAllBut = (keep: Set<Entry>) => {
    const drop = pending().filter((e) => !keep.has(e))
    for (const e of drop) cache.deleteValue(e)
    if (drop.length) deps.engine.drop(drop.map((e) => e.job))
  }

  const stop = () => {
    element.stop()
    dropAllBut(new Set())
  }

  const speak = (text: string, options: SpeakOptions, handlers: SpeakHandlers) => {
    element.stop()
    const voice = workerVoice(options.voice?.voiceURI)
    if (!voice) {
      handlers.onError('failed')
      return
    }
    const turn = element.begin(handlers, options.rate)
    deps.engine.load(voice).catch((error: unknown) => {
      if (error instanceof EngineError && PROBLEMS.has(error.code)) element.fail(turn, error.code)
    })
    const entry = entryFor(voice.id, text)
    const ahead = (options.local?.upcoming ?? []).slice(0, AHEAD).map((t) => entryFor(voice.id, t))
    dropAllBut(new Set([entry, ...ahead]))
    entry.result.then(
      (made) => {
        if (!element.isCurrent(turn)) return
        count(entry, made, options.rate)
        for (const next of ahead) void next.result.then((m) => count(next, m, options.rate)).catch(() => {})
        element.play(turn, entry.url ?? '')
      },
      (error: unknown) => {
        if (!element.isCurrent(turn)) return
        const code = error instanceof EngineError ? error.code : 'failed'
        element.fail(turn, PROBLEMS.has(code) ? code : 'failed')
      },
    )
  }

  return {
    speak,
    stop,
    prime: element.prime,
    close: () => {
      stop()
      cache.clear()
      slowRun = 0
      element.release()
    },
  }
}
