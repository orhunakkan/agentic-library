import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpeakRequest, SpokenWord } from '~/shared/read-aloud/cloud'
import { fakeAudio } from '../../../../tests/fixtures/fake-audio'
import {
  BUSY_RETRY_MS,
  CACHE_SIZE,
  type CloudSpeakOptions,
  createCloudSpeaker,
  END_SLACK_MS,
  type SpeakRef,
  START_WATCHDOG_MS,
} from './cloud-speaker'
import type { SpeakOptions } from './speaker'
import type { SpeakResult } from './speech-client'

function fakeServer() {
  const requests: { request: SpeakRequest; signal: AbortSignal; done: boolean; answer: (r: SpeakResult) => void }[] = []
  const speak = vi.fn(
    (request: SpeakRequest, signal: AbortSignal) =>
      new Promise<SpeakResult>((resolve) => {
        const entry = {
          request,
          signal,
          done: false,
          answer: (r: SpeakResult) => {
            entry.done = true
            resolve(r)
          },
        }
        requests.push(entry)
      }),
  )
  const ok = (words: SpokenWord[] = [], format: 'low' | 'standard' = 'low'): SpeakResult => ({
    ok: true,
    audio: new Blob(['mp3'], { type: 'audio/mpeg' }),
    words,
    format,
  })
  return { requests, speak, ok, inFlight: () => requests.filter((r) => !r.signal.aborted && !r.done) }
}

function setup() {
  const audio = fakeAudio()
  const server = fakeServer()
  let made = 0
  const revoked: string[] = []
  const frames: (() => void)[] = []
  const onWord = vi.fn()
  const speaker = createCloudSpeaker({
    audio,
    speak: server.speak,
    onWord,
    urls: { create: () => `blob:${++made}`, revoke: (url) => void revoked.push(url) },
    frames: { request: (fn) => frames.push(fn), cancel: () => void frames.splice(0) },
  })
  const runFrame = () => frames.splice(0).forEach((fn) => void fn())
  return { audio, server, speaker, revoked, onWord, runFrame, created: () => made }
}

const ref = (start: number, page = 1): SpeakRef => ({
  book: 'pride-and-prejudice',
  chapter: 0,
  position: { chapter: 'chapter-1', page },
  start,
  end: start + 10,
})

const options = (cloud: Partial<CloudSpeakOptions> & { ref: SpeakRef }, rate = 1): SpeakOptions => ({
  lang: 'en',
  rate,
  voice: { voiceURI: 'elevenlabs:Aria01', name: 'Aria', lang: 'en' } as SpeechSynthesisVoice,
  cloud: { upcoming: null, model: 'eleven_v4_turbo', ...cloud },
})

const handlers = () => ({ onStart: vi.fn(), onEnd: vi.fn(), onError: vi.fn() })
const flush = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('createCloudSpeaker', () => {
  it('fetches the utterance by its ref, plays it at the speed with the pitch kept, and reports start and end', async () => {
    const { audio, server, speaker } = setup()
    const h = handlers()
    speaker.speak('ignored text', options({ ref: ref(0) }, 1.5), h)
    expect(server.requests[0]?.request).toEqual({ ...ref(0), voice: 'Aria01', format: 'low' })
    server.requests[0]?.answer(server.ok())
    await flush()
    expect(audio.src).toBe('blob:1')
    expect(audio.playbackRate).toBe(1.5)
    expect(audio.preservesPitch).toBe(true)
    expect(audio.play).toHaveBeenCalledTimes(1)
    audio.fire('playing')
    expect(h.onStart).toHaveBeenCalledTimes(1)
    audio.fire('ended')
    expect(h.onEnd).toHaveBeenCalledTimes(1)
    expect(h.onError).not.toHaveBeenCalled()
  })

  it('reports a failed request with its problem, and a media error', async () => {
    const { audio, server, speaker } = setup()
    const h = handlers()
    speaker.speak('', options({ ref: ref(0) }), h)
    server.requests[0]?.answer({ ok: false, problem: 'no_credits' })
    await flush()
    expect(h.onError).toHaveBeenCalledWith('no_credits')
    const h2 = handlers()
    speaker.speak('', options({ ref: ref(20) }), h2)
    server.requests[1]?.answer(server.ok())
    await flush()
    audio.fire('error')
    expect(h2.onError).toHaveBeenCalledWith('media')
    speaker.speak('', options({ ref: ref(0) }), handlers())
    expect(server.requests).toHaveLength(3)
  })

  it('passes on when the hourly limit allows more', async () => {
    const { server, speaker } = setup()
    const h = handlers()
    speaker.speak('', options({ ref: ref(0) }), h)
    server.requests[0]?.answer({ ok: false, problem: 'rate', retryAt: new Date(5000) })
    await flush()
    expect(h.onError).toHaveBeenCalledWith('rate', new Date(5000))
  })

  it('says blocked when the browser wants a press first, and media when it can’t play the audio', async () => {
    const { audio, server, speaker } = setup()
    audio.refuse = 'NotAllowedError'
    const h = handlers()
    speaker.speak('', options({ ref: ref(0) }), h)
    server.requests[0]?.answer(server.ok())
    await flush()
    expect(h.onError).toHaveBeenCalledWith('blocked')
    audio.refuse = 'NotSupportedError'
    const unplayable = handlers()
    speaker.speak('', options({ ref: ref(20) }), unplayable)
    server.requests[1]?.answer(server.ok())
    await flush()
    expect(unplayable.onError).toHaveBeenCalledWith('media')
  })

  it('fails at once without a cloud voice or a ref', () => {
    const { server, speaker } = setup()
    const h = handlers()
    speaker.speak('', { lang: 'en', rate: 1, voice: null }, h)
    expect(h.onError).toHaveBeenCalledWith('failed')
    const device = handlers()
    speaker.speak('', { ...options({ ref: ref(0) }), voice: { voiceURI: 'Samantha' } as SpeechSynthesisVoice }, device)
    expect(device.onError).toHaveBeenCalledWith('failed')
    expect(server.requests).toHaveLength(0)
  })

  it('stop() pauses and drops the handlers, but lets a prefetch finish', async () => {
    const { audio, server, speaker } = setup()
    const h = handlers()
    speaker.speak('', options({ ref: ref(0), upcoming: ref(20) }), h)
    server.requests[0]?.answer(server.ok())
    await flush()
    audio.fire('playing')
    speaker.stop()
    expect(audio.pause).toHaveBeenCalled()
    audio.fire('ended')
    audio.fire('error')
    expect(h.onEnd).not.toHaveBeenCalled()
    expect(h.onError).not.toHaveBeenCalled()
    expect(server.requests[1]?.signal.aborted).toBe(false)
  })

  it('replays a cached utterance without asking again, and a different voice or model is a new recording', async () => {
    const { audio, server, speaker } = setup()
    speaker.speak('', options({ ref: ref(0) }), handlers())
    server.requests[0]?.answer(server.ok())
    await flush()
    speaker.stop()
    speaker.speak('', options({ ref: ref(0) }), handlers())
    await flush()
    expect(server.requests).toHaveLength(1)
    expect(audio.played).toEqual(['blob:1', 'blob:1'])
    speaker.speak('', options({ ref: ref(0), model: 'eleven_v4' }), handlers())
    expect(server.requests).toHaveLength(2)
  })

  it('fetches one utterance ahead once the current one is ready, with at most 2 requests in flight', async () => {
    const { server, speaker } = setup()
    speaker.speak('', options({ ref: ref(0), upcoming: ref(20) }), handlers())
    expect(server.requests).toHaveLength(1)
    server.requests[0]?.answer(server.ok())
    await flush()
    expect(server.requests.map((r) => 'start' in r.request && r.request.start)).toEqual([0, 20])

    speaker.speak('', options({ ref: ref(40), upcoming: ref(60) }), handlers())
    expect(server.inFlight()).toHaveLength(2)
    server.requests[2]?.answer(server.ok())
    await flush()
    expect(server.inFlight().map((r) => 'start' in r.request && r.request.start)).toEqual([20, 60])

    speaker.speak('', options({ ref: ref(80), upcoming: ref(100) }), handlers())
    expect(server.requests[1]?.signal.aborted).toBe(true)
    expect(server.inFlight().map((r) => 'start' in r.request && r.request.start)).toEqual([60, 80])
    server.requests[4]?.answer(server.ok())
    await flush()
    expect(server.inFlight().map((r) => 'start' in r.request && r.request.start)).toEqual([60, 100])
    speaker.speak('', options({ ref: ref(60), upcoming: ref(120) }), handlers())
    server.requests[3]?.answer(server.ok())
    await flush()
    expect(server.inFlight().map((r) => 'start' in r.request && r.request.start)).toEqual([100, 120])
    server.requests[5]?.answer(server.ok())
    speaker.speak('', options({ ref: ref(140), upcoming: ref(160) }), handlers())
    expect(server.inFlight().map((r) => 'start' in r.request && r.request.start)).toEqual([120, 140])
    speaker.speak('', options({ ref: ref(180), upcoming: ref(200) }), handlers())
    expect(server.inFlight()).toHaveLength(2)
  })

  it('keeps the last 40 utterances, revoking the URL of the one it drops', async () => {
    const { server, speaker, revoked } = setup()
    for (let i = 0; i <= CACHE_SIZE; i++) {
      speaker.speak('', options({ ref: ref(i * 20) }), handlers())
      server.requests[i]?.answer(server.ok())
      await flush()
    }
    expect(revoked).toEqual(['blob:1'])
    speaker.speak('', options({ ref: ref(20) }), handlers())
    expect(server.requests).toHaveLength(CACHE_SIZE + 1)
    speaker.speak('', options({ ref: ref(0) }), handlers())
    expect(server.requests).toHaveLength(CACHE_SIZE + 2)
  })

  it('gives up on an utterance that never starts, or plays past its length', async () => {
    const { audio, server, speaker } = setup()
    const waiting = handlers()
    speaker.speak('', options({ ref: ref(0) }), waiting)
    await vi.advanceTimersByTimeAsync(START_WATCHDOG_MS)
    expect(waiting.onError).toHaveBeenCalledWith('timeout')

    const stuck = handlers()
    speaker.speak('', options({ ref: ref(20) }, 2), stuck)
    server.requests[1]?.answer(server.ok())
    await flush()
    audio.duration = 4
    audio.fire('playing')
    await vi.advanceTimersByTimeAsync(2000 + END_SLACK_MS - 1)
    expect(stuck.onError).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(stuck.onError).toHaveBeenCalledWith('timeout')
  })

  it('marks the word the audio is at, whatever the speed, and clears it when stopped', async () => {
    const { audio, server, speaker, onWord, runFrame } = setup()
    const words = [
      { start: 0, end: 2, t0: 0, t1: 300 },
      { start: 3, end: 5, t0: 300, t1: 600 },
    ]
    speaker.speak('', options({ ref: ref(0) }, 2), handlers())
    server.requests[0]?.answer(server.ok(words))
    await flush()
    audio.currentTime = 0.1
    audio.fire('playing')
    expect(onWord).toHaveBeenLastCalledWith({ start: 0, end: 2 })
    audio.currentTime = 0.45
    runFrame()
    expect(onWord).toHaveBeenLastCalledWith({ start: 3, end: 5 })
    runFrame()
    expect(onWord).toHaveBeenCalledTimes(2)
    audio.currentTime = 1.2
    runFrame()
    expect(onWord).toHaveBeenLastCalledWith(null)
    audio.currentTime = 0.4
    runFrame()
    speaker.stop()
    expect(onWord).toHaveBeenLastCalledWith(null)
  })

  it('prime() plays silence synchronously, and its events are not an utterance’s', () => {
    const { audio, speaker } = setup()
    const h = handlers()
    speaker.prime()
    expect(audio.play).toHaveBeenCalledTimes(1)
    expect(audio.src).toMatch(/^data:audio\/wav;base64,UklGR/)
    speaker.speak('', options({ ref: ref(0) }), h)
    audio.src = audio.played[0] ?? ''
    audio.fire('playing')
    audio.fire('ended')
    audio.fire('error')
    expect(h.onStart).not.toHaveBeenCalled()
    expect(h.onEnd).not.toHaveBeenCalled()
    expect(h.onError).not.toHaveBeenCalled()
  })

  it('asks for the standard rate once an answer says so, until close() forgets it with the cache', async () => {
    const { audio, server, speaker, revoked } = setup()
    speaker.speak('', options({ ref: ref(0) }), handlers())
    server.requests[0]?.answer(server.ok([], 'standard'))
    await flush()
    speaker.speak('', options({ ref: ref(20) }), handlers())
    expect(server.requests[1]?.request.format).toBe('standard')
    speaker.close()
    expect(server.requests[1]?.signal.aborted).toBe(true)
    expect(revoked).toEqual(['blob:1'])
    expect(audio.removeAttribute).toHaveBeenCalledWith('src')
    speaker.speak('', options({ ref: ref(0) }), handlers())
    expect(server.requests[2]?.request.format).toBe('low')
  })

  it('asks once more a second after busy, then gives up with busy', async () => {
    const { server, speaker } = setup()
    const h = handlers()
    speaker.speak('', options({ ref: ref(0) }), h)
    server.requests[0]?.answer({ ok: false, problem: 'busy' })
    await flush()
    expect(server.requests).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(BUSY_RETRY_MS)
    expect(server.requests).toHaveLength(2)
    server.requests[1]?.answer({ ok: false, problem: 'busy' })
    await flush()
    expect(h.onError).toHaveBeenCalledWith('busy')
    expect(server.requests).toHaveLength(2)
  })

  it('drops an answer that arrives after close()', async () => {
    const { server, speaker, revoked, created } = setup()
    const h = handlers()
    speaker.speak('', options({ ref: ref(0) }), h)
    speaker.close()
    server.requests[0]?.answer(server.ok())
    await flush()
    expect(h.onEnd).not.toHaveBeenCalled()
    expect(h.onError).not.toHaveBeenCalled()
    expect(created()).toBe(0)
    expect(revoked).toEqual([])
  })

  it('a prefetch never takes a slot: with two requests in flight it waits', async () => {
    const { server, speaker } = setup()
    speaker.speak('', options({ ref: ref(0) }), handlers())
    server.requests[0]?.answer(server.ok())
    await flush()
    speaker.speak('', options({ ref: ref(20) }), handlers())
    speaker.speak('', options({ ref: ref(40) }), handlers())
    speaker.speak('', options({ ref: ref(0), upcoming: ref(60) }), handlers())
    await flush()
    expect(server.inFlight().map((r) => 'start' in r.request && r.request.start)).toEqual([20, 40])
    expect(server.requests).toHaveLength(3)
  })

  it('tells apart the same span on another page, of a chapter or a printed book', async () => {
    const { server, speaker } = setup()
    speaker.speak('', options({ ref: ref(0, 1) }), handlers())
    server.requests[0]?.answer(server.ok())
    await flush()
    speaker.speak('', options({ ref: ref(0, 2) }), handlers())
    expect(server.requests).toHaveLength(2)
    expect(server.requests[1]?.request).toMatchObject({ position: { chapter: 'chapter-1', page: 2 }, start: 0 })
    const printed = (printedPage: number): SpeakRef => ({
      book: 'confessions',
      chapter: 0,
      position: { printedPage },
      start: 0,
      end: 10,
    })
    speaker.speak('', options({ ref: printed(3) }), handlers())
    server.requests[2]?.answer(server.ok())
    await flush()
    speaker.speak('', options({ ref: printed(4) }), handlers())
    expect(server.requests).toHaveLength(4)
  })

  it('keeps a word marked for a quarter of a second after its end, across a pause in the voice', async () => {
    const { audio, server, speaker, onWord, runFrame } = setup()
    const words = [
      { start: 0, end: 2, t0: 0, t1: 300 },
      { start: 3, end: 5, t0: 600, t1: 900 },
    ]
    speaker.speak('', options({ ref: ref(0) }), handlers())
    server.requests[0]?.answer(server.ok(words))
    await flush()
    audio.currentTime = 0.1
    audio.fire('playing')
    audio.currentTime = 0.54
    runFrame()
    expect(onWord.mock.calls).toEqual([[{ start: 0, end: 2 }]])
    audio.currentTime = 0.56
    runFrame()
    expect(onWord).toHaveBeenLastCalledWith(null)
  })
})
