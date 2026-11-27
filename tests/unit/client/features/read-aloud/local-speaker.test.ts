import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { START_WATCHDOG_MS } from '~/client/features/read-aloud/audio-speaker'
import {
  createLocalSpeaker,
  LOCAL_CACHE_SIZE,
  LOCAL_VOICE_PREFIX,
  wavDurationMs,
  workerVoice,
} from '~/client/features/read-aloud/local-speaker'
import { type Engine, EngineError, type Made } from '~/client/features/read-aloud/piper/engine'
import { wav } from '~/client/features/read-aloud/piper/wav'
import type { SpeakOptions } from '~/client/features/read-aloud/speaker'
import { fakeAudio } from '../../../../fixtures/fake-audio'

const CORI = `${LOCAL_VOICE_PREFIX}en_GB-cori-medium`

const wavOf = (ms: number) => wav(new Float32Array(ms), 1000).buffer

function fakeEngine() {
  const jobs: { id: string; text: string; resolve: (m: Made) => void; reject: (e: EngineError) => void }[] = []
  const load = vi.fn(async () => {})
  const engine: Engine = {
    load,
    synth: (id, text) =>
      new Promise<Made>((resolve, reject) => {
        jobs.push({ id, text, resolve, reject })
      }),
    drop: vi.fn((ids: string[]) => {
      for (const id of ids) jobs.find((j) => j.id === id)?.reject(new EngineError('dropped'))
    }),
    terminate: vi.fn(),
  }
  const job = (text: string) => {
    const found = jobs.find((j) => j.text === text)
    if (!found) throw new Error(`no job for ${text}`)
    return found
  }
  return { engine, jobs, load, job, texts: () => jobs.map((j) => j.text) }
}

function setup() {
  const audio = fakeAudio()
  const fake = fakeEngine()
  const onSlow = vi.fn()
  let made = 0
  const revoked: string[] = []
  const speaker = createLocalSpeaker({
    audio,
    engine: fake.engine,
    onSlow,
    urls: { create: () => `blob:${++made}`, revoke: (url) => void revoked.push(url) },
  })
  return { audio, speaker, onSlow, revoked, ...fake }
}

const options = (upcoming: string[] = [], rate = 1, voice = CORI): SpeakOptions => ({
  lang: 'en-GB',
  rate,
  voice: { voiceURI: voice, name: 'Cori', lang: 'en-GB' } as SpeechSynthesisVoice,
  ahead: upcoming.map((text) => ({ text })),
})
const handlers = () => ({ onStart: vi.fn(), onEnd: vi.fn(), onError: vi.fn() })
const flush = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('workerVoice', () => {
  it('finds a Folio voice’s files, and nothing for another voice', () => {
    expect(workerVoice(CORI)).toEqual({
      id: 'en_GB-cori-medium',
      model: '/voices/en_GB-cori-medium.2e0a55e140de.onnx',
      config: '/voices/en_GB-cori-medium.f89b01c5e483.json',
    })
    expect(workerVoice('folio:nope')).toBeNull()
    expect(workerVoice('Google UK English')).toBeNull()
    expect(workerVoice(undefined)).toBeNull()
  })
})

describe('wavDurationMs', () => {
  it('reads the header', () => {
    expect(wavDurationMs(wavOf(1500))).toBe(1500)
    expect(wavDurationMs(new ArrayBuffer(10))).toBe(0)
  })
})

describe('createLocalSpeaker', () => {
  it('makes the utterance and two ahead, plays it at the speed, and reports start and end', async () => {
    const { audio, speaker, job, texts, load } = setup()
    const h = handlers()
    speaker.speak('One.', options(['Two.', 'Three.', 'Four.'], 1.5), h)
    expect(load).toHaveBeenCalledWith(workerVoice(CORI))
    expect(texts()).toEqual(['One.', 'Two.', 'Three.'])
    job('One.').resolve({ wav: wavOf(1000), ms: 100 })
    await flush()
    expect(audio.src).toBe('blob:1')
    expect(audio.playbackRate).toBe(1.5)
    expect(audio.preservesPitch).toBe(true)
    audio.fire('playing')
    audio.fire('ended')
    expect(h.onStart).toHaveBeenCalled()
    expect(h.onEnd).toHaveBeenCalled()
  })

  it('makes nothing ahead for the next chapter’s intro, which has no text yet', () => {
    const { speaker, texts } = setup()
    const intro = { book: 'essays', chapter: 1, intro: true as const }
    speaker.speak('One.', { ...options(), ahead: [{ text: 'Two.' }, { ref: intro }] }, handlers())
    expect(texts()).toEqual(['One.', 'Two.'])
  })

  it('makes no job for a cached utterance, at any speed', async () => {
    const { audio, speaker, job, jobs } = setup()
    speaker.speak('One.', options(), handlers())
    job('One.').resolve({ wav: wavOf(1000), ms: 100 })
    await flush()
    speaker.speak('One.', options([], 2), handlers())
    await flush()
    expect(jobs).toHaveLength(1)
    expect(audio.played).toEqual(['blob:1', 'blob:1'])
    expect(audio.playbackRate).toBe(2)
  })

  it('makes the utterance again in another Folio voice, rather than playing the first voice’s', async () => {
    const { audio, speaker, jobs } = setup()
    speaker.speak('One.', options(), handlers())
    jobs[0]?.resolve({ wav: wavOf(1000), ms: 100 })
    await flush()
    speaker.speak('One.', options([], 1, `${LOCAL_VOICE_PREFIX}en_US-ljspeech-medium`), handlers())
    expect(jobs).toHaveLength(2)
    jobs[1]?.resolve({ wav: wavOf(1000), ms: 100 })
    await flush()
    expect(audio.played).toEqual(['blob:1', 'blob:2'])
  })

  it('drops jobs for utterances that are no longer next, and every waiting job on stop()', async () => {
    const { speaker, engine, texts } = setup()
    speaker.speak('One.', options(['Two.', 'Three.']), handlers())
    speaker.speak('Ten.', options(['Eleven.']), handlers())
    expect(engine.drop).toHaveBeenCalledWith(expect.arrayContaining(['u1', 'u2', 'u3']))
    expect(texts()).toContain('Eleven.')
    speaker.stop()
    expect(engine.drop).toHaveBeenLastCalledWith(['u4', 'u5'])
  })

  it('says the device is slow once, after three utterances in a row made more slowly than they play', async () => {
    const { speaker, job, onSlow } = setup()
    const say = async (text: string, ms: number) => {
      speaker.speak(text, options(), handlers())
      job(text).resolve({ wav: wavOf(1000), ms })
      await flush()
    }
    await say('A.', 1500)
    await say('B.', 1500)
    await say('C.', 100)
    await say('D.', 1500)
    await say('E.', 1500)
    expect(onSlow).not.toHaveBeenCalled()
    await say('F.', 1500)
    expect(onSlow).toHaveBeenCalledTimes(1)
    await say('G.', 1500)
    await say('H.', 1500)
    await say('I.', 1500)
    expect(onSlow).toHaveBeenCalledTimes(1)
  })

  it('counts against the speed: at 2× a sentence must be made in half its length', async () => {
    const { speaker, job, onSlow } = setup()
    for (const text of ['A.', 'B.', 'C.']) {
      speaker.speak(text, options([], 2), handlers())
      job(text).resolve({ wav: wavOf(1000), ms: 600 })
      await flush()
    }
    expect(onSlow).toHaveBeenCalledTimes(1)
  })

  it('reports local_missing and local_failed as problems, and a failed sentence as failed', async () => {
    const { speaker, job, load } = setup()
    load.mockRejectedValueOnce(new EngineError('local_missing'))
    const a = handlers()
    speaker.speak('A.', options(), a)
    await flush()
    expect(a.onError).toHaveBeenCalledWith({ kind: 'local', code: 'local_missing' })
    const b = handlers()
    speaker.speak('B.', options(), b)
    job('B.').reject(new EngineError('local_failed'))
    await flush()
    expect(b.onError).toHaveBeenCalledWith({ kind: 'local', code: 'local_failed' })
    const c = handlers()
    speaker.speak('C.', options(), c)
    job('C.').reject(new EngineError('synth_failed'))
    await flush()
    expect(c.onError).toHaveBeenCalledWith({ kind: 'failed' })
  })

  it('says blocked when the browser wants a press first, as the cloud speaker does', async () => {
    const { audio, speaker, job } = setup()
    audio.refuse = 'NotAllowedError'
    const h = handlers()
    speaker.speak('A.', options(), h)
    job('A.').resolve({ wav: wavOf(1000), ms: 100 })
    await flush()
    expect(h.onError).toHaveBeenCalledWith({ kind: 'blocked' })
  })

  it('fails at once without a Folio voice', () => {
    const { speaker } = setup()
    const h = handlers()
    speaker.speak('A.', options([], 1, 'Google UK English'), h)
    expect(h.onError).toHaveBeenCalledWith({ kind: 'failed' })
  })

  it('gives up on an utterance that is never made', () => {
    const { speaker } = setup()
    const h = handlers()
    speaker.speak('A.', options(), h)
    vi.advanceTimersByTime(START_WATCHDOG_MS)
    expect(h.onError).toHaveBeenCalledWith({ kind: 'failed' })
  })

  it('keeps the last 20 utterances, revoking the URL of the one it drops', async () => {
    const { speaker, job, revoked } = setup()
    for (let i = 0; i <= LOCAL_CACHE_SIZE; i++) {
      speaker.speak(`S${i}.`, options(), handlers())
      job(`S${i}.`).resolve({ wav: wavOf(10), ms: 1 })
      await flush()
    }
    expect(revoked).toEqual(['blob:1'])
  })

  it('prime() plays silence synchronously, and close() lets everything go', async () => {
    const { audio, speaker, job, revoked } = setup()
    speaker.prime()
    expect(audio.play).toHaveBeenCalledTimes(1)
    speaker.speak('A.', options(), handlers())
    job('A.').resolve({ wav: wavOf(10), ms: 1 })
    await flush()
    speaker.close()
    expect(revoked).toEqual(['blob:1'])
    expect(audio.removeAttribute).toHaveBeenCalledWith('src')
  })
})
