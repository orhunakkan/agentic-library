/// <reference lib="webworker" />
import createPiperPhonemize from '@diffusionstudio/piper-wasm/build/piper_phonemize.js'
import * as ort from 'onnxruntime-web/wasm'
import { VOICES_CACHE } from '~/shared/read-aloud/folio-voices'
import { type PiperPhonemeConfig, phonemeIds, sentences, splitPhonemes, textPhonemes } from './phonemes'
import type { FromWorker, ToWorker, WorkerErrorCode, WorkerVoice } from './protocol'
import { normalise, wav } from './wav'

declare const self: DedicatedWorkerGlobalScope

interface VoiceConfig extends PiperPhonemeConfig {
  audio: { sample_rate: number }
  espeak: { voice: string }
  inference?: { noise_scale?: number; length_scale?: number; noise_w?: number }
  num_speakers?: number
  default_speaker_id?: number
}

interface Loaded {
  id: string
  session: ort.InferenceSession
  config: VoiceConfig
  phonemize: ((text: string) => string) | null
}

class LoadError extends Error {
  constructor(readonly code: WorkerErrorCode) {
    super(code)
  }
}

const post = (message: FromWorker, transfer: Transferable[] = []) => self.postMessage(message, transfer)

async function kept(url: string): Promise<Response | undefined> {
  try {
    return (await (await caches.open(VOICES_CACHE)).match(url)) ?? undefined
  } catch {
    return undefined
  }
}

async function engineBytes(url: string): Promise<ArrayBuffer> {
  const response = (await kept(url)) ?? (await fetch(url))
  if (!response.ok) throw new LoadError('local_failed')
  return response.arrayBuffer()
}

let phonemizer: Promise<{ callMain: (args: string[]) => number; out: { line: string } }> | null = null

function startPhonemizer(engine: { piperWasm: string; piperData: string }) {
  phonemizer ??= (async () => {
    const [wasmBinary, data] = await Promise.all([engineBytes(engine.piperWasm), engineBytes(engine.piperData)])
    const out = { line: '' }
    const module = await createPiperPhonemize({
      print: (line) => {
        out.line = line
      },
      printErr: () => {},
      wasmBinary,
      getPreloadedPackage: () => data,
      locateFile: (path) => path,
    })
    return { callMain: module.callMain, out }
  })()
  phonemizer.catch(() => {
    phonemizer = null
  })
  return phonemizer
}

let loaded: Promise<Loaded> | null = null

async function load(voice: WorkerVoice, engine: Extract<ToWorker, { type: 'load' }>['engine']): Promise<Loaded> {
  const [model, configResponse] = await Promise.all([kept(voice.model), kept(voice.config)])
  if (!model || !configResponse) throw new LoadError('local_missing')
  try {
    const config = (await configResponse.json()) as VoiceConfig
    ort.env.wasm.numThreads = 1
    ort.env.wasm.proxy = false
    ort.env.wasm.wasmBinary = await engineBytes(engine.ortWasm)
    const session = await ort.InferenceSession.create(new Uint8Array(await model.arrayBuffer()))
    let phonemize: Loaded['phonemize'] = null
    if (config.phoneme_type !== 'text') {
      const phonemizer = await startPhonemizer(engine)
      phonemize = (text) => {
        phonemizer.out.line = ''
        phonemizer.callMain([
          '-l',
          config.espeak.voice,
          '--input',
          JSON.stringify([{ text }]),
          '--espeak_data',
          '/espeak-ng-data',
        ])
        const answer = JSON.parse(phonemizer.out.line || '{"phonemes":[]}') as { phonemes?: string[] }
        return (answer.phonemes ?? []).join('')
      }
    }
    return { id: voice.id, session, config, phonemize }
  } catch (error) {
    throw error instanceof LoadError ? error : new LoadError('local_failed')
  }
}

const quiet = (rate: number) => new Float32Array(Math.round(rate / 10))

async function synth(voice: Loaded, text: string): Promise<Float32Array> {
  const { config } = voice
  const phonemes = voice.phonemize ? splitPhonemes(voice.phonemize(text), config) : textPhonemes(text)
  const groups = voice.phonemize ? sentences(phonemes) : [phonemes]
  const inference = config.inference ?? {}
  const scales = new Float32Array([
    inference.noise_scale ?? 0.667,
    inference.length_scale ?? 1,
    inference.noise_w ?? 0.8,
  ])
  const parts: Float32Array[] = []
  for (const group of groups) {
    const ids = phonemeIds(group, config)
    const feeds: Record<string, ort.Tensor> = {
      input: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
      input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
      scales: new ort.Tensor('float32', scales, [3]),
    }
    if ((config.num_speakers ?? 1) > 1)
      feeds.sid = new ort.Tensor('int64', BigInt64Array.from([BigInt(config.default_speaker_id ?? 0)]), [1])
    const result = await voice.session.run(feeds)
    const output = result.output
    if (output) parts.push(normalise(output.data as Float32Array))
  }
  if (parts.length === 0) return quiet(config.audio.sample_rate)
  const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    all.set(p, at)
    at += p.length
  }
  return all
}

const queue: { id: string; text: string }[] = []
let running = false

async function pump() {
  if (running) return
  running = true
  while (queue.length > 0) {
    const job = queue.shift() as { id: string; text: string }
    let voice: Loaded
    try {
      if (!loaded) throw new LoadError('local_failed')
      voice = await loaded
    } catch (error) {
      post({ type: 'error', id: job.id, code: error instanceof LoadError ? error.code : 'local_failed' })
      continue
    }
    try {
      const started = performance.now()
      const pcm = await synth(voice, job.text)
      const bytes = wav(pcm, voice.config.audio.sample_rate)
      post({ type: 'audio', id: job.id, wav: bytes.buffer, ms: Math.round(performance.now() - started) }, [
        bytes.buffer,
      ])
    } catch {
      post({ type: 'error', id: job.id, code: 'synth_failed' })
    }
  }
  running = false
}

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const message = event.data
  if (message.type === 'load') {
    const mine = load(message.voice, message.engine)
    loaded = mine
    mine.then(
      (voice) => loaded === mine && post({ type: 'ready', voice: voice.id }),
      (error: unknown) =>
        loaded === mine && post({ type: 'error', code: error instanceof LoadError ? error.code : 'local_failed' }),
    )
  } else if (message.type === 'synth') {
    queue.push({ id: message.id, text: message.text })
    void pump()
  } else if (message.type === 'cancel') {
    const drop = new Set(message.ids)
    for (let i = queue.length - 1; i >= 0; i--) if (drop.has((queue[i] as { id: string }).id)) queue.splice(i, 1)
  }
}
