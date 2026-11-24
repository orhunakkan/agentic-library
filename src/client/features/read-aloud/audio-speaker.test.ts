import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeAudio } from '../../../../tests/fixtures/fake-audio'
import { createAudioSpeaker, END_SLACK_MS, START_WATCHDOG_MS, UrlCache } from './audio-speaker'

const handlers = () => ({ onStart: vi.fn(), onEnd: vi.fn(), onError: vi.fn() })
const flush = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('createAudioSpeaker', () => {
  it('plays a turn at its speed with the pitch kept, and reports start and end', () => {
    const audio = fakeAudio()
    const element = createAudioSpeaker(audio)
    const h = handlers()
    const onPlaying = vi.fn()
    const turn = element.begin(h, 1.5, { onPlaying })
    element.play(turn, 'blob:1')
    expect(audio.src).toBe('blob:1')
    expect(audio.playbackRate).toBe(1.5)
    expect(audio.preservesPitch).toBe(true)
    audio.fire('playing')
    audio.fire('playing')
    expect(h.onStart).toHaveBeenCalledTimes(1)
    expect(onPlaying).toHaveBeenCalledTimes(1)
    audio.fire('ended')
    expect(h.onEnd).toHaveBeenCalledTimes(1)
    expect(element.isCurrent(turn)).toBe(false)
  })

  it('fails on a media error, and is blocked or fails when play() is refused', async () => {
    const audio = fakeAudio()
    const element = createAudioSpeaker(audio)
    const a = handlers()
    element.play(element.begin(a, 1), 'blob:1')
    audio.fire('error')
    expect(a.onError).toHaveBeenCalledWith({ kind: 'failed' })
    audio.refuse = 'NotAllowedError'
    const b = handlers()
    element.play(element.begin(b, 1), 'blob:2')
    await flush()
    expect(b.onError).toHaveBeenCalledWith({ kind: 'blocked' })
    audio.refuse = 'NotSupportedError'
    const c = handlers()
    element.play(element.begin(c, 1), 'blob:3')
    await flush()
    expect(c.onError).toHaveBeenCalledWith({ kind: 'failed' })
  })

  it('gives up on a turn that never starts, or plays past its length at the speed', () => {
    const audio = fakeAudio()
    const element = createAudioSpeaker(audio)
    const a = handlers()
    element.begin(a, 1)
    vi.advanceTimersByTime(START_WATCHDOG_MS)
    expect(a.onError).toHaveBeenCalledWith({ kind: 'failed' })
    const b = handlers()
    element.play(element.begin(b, 2), 'blob:1')
    audio.duration = 10
    audio.fire('playing')
    vi.advanceTimersByTime(5000 + END_SLACK_MS - 1)
    expect(b.onError).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(b.onError).toHaveBeenCalledWith({ kind: 'failed' })
  })

  it('once a turn plays, only its length counts: a slow start doesn’t cut a long sentence short', () => {
    const audio = fakeAudio()
    const element = createAudioSpeaker(audio)
    const h = handlers()
    const turn = element.begin(h, 1)
    vi.advanceTimersByTime(20_000)
    element.play(turn, 'blob:1')
    audio.duration = 15
    audio.fire('playing')
    vi.advanceTimersByTime(15_000 + END_SLACK_MS - 1)
    expect(h.onError).not.toHaveBeenCalled()
    audio.fire('ended')
    expect(h.onEnd).toHaveBeenCalledTimes(1)
  })

  it('fails a turn with its problem, and ignores a turn that is no longer current', () => {
    const audio = fakeAudio()
    const element = createAudioSpeaker(audio)
    const a = handlers()
    const old = element.begin(a, 1)
    const b = handlers()
    const turn = element.begin(b, 1)
    element.fail(old, { kind: 'failed' })
    element.play(old, 'blob:old')
    expect(a.onError).not.toHaveBeenCalled()
    expect(audio.src).toBe('')
    const problem = { kind: 'cloud', code: 'rate', retryAt: new Date(1000) } as const
    element.fail(turn, problem)
    expect(b.onError).toHaveBeenCalledWith(problem)
  })

  it('stop() drops the turn without its handlers, and clears it', () => {
    const audio = fakeAudio()
    const element = createAudioSpeaker(audio)
    const h = handlers()
    const onClear = vi.fn()
    element.play(element.begin(h, 1, { onClear }), 'blob:1')
    element.stop()
    audio.fire('ended')
    expect(h.onEnd).not.toHaveBeenCalled()
    expect(onClear).toHaveBeenCalledTimes(1)
    expect(audio.pause).toHaveBeenCalled()
  })

  it('prime() plays silence synchronously, whose events are no turn’s, and release() lets the source go', () => {
    const audio = fakeAudio()
    const element = createAudioSpeaker(audio)
    const h = handlers()
    element.begin(h, 1)
    element.prime()
    expect(audio.src).toMatch(/^data:audio\/wav;base64,/)
    expect(audio.play).toHaveBeenCalledTimes(1)
    audio.fire('playing')
    audio.fire('error')
    expect(h.onStart).not.toHaveBeenCalled()
    expect(h.onError).not.toHaveBeenCalled()
    element.release()
    expect(audio.removeAttribute).toHaveBeenCalledWith('src')
    expect(audio.load).toHaveBeenCalled()
  })

  it('two speakers on one element prime it once per press, and either then plays its first turn', async () => {
    const audio = fakeAudio()
    const cloud = createAudioSpeaker(audio)
    const folio = createAudioSpeaker(audio)
    cloud.prime()
    folio.prime()
    expect(audio.play).toHaveBeenCalledTimes(1)
    await flush()
    for (const [speaker, url] of [
      [cloud, 'blob:cloud'],
      [folio, 'blob:folio'],
    ] as const) {
      cloud.stop()
      folio.stop()
      const h = handlers()
      speaker.play(speaker.begin(h, 1), url)
      expect(audio.src).toBe(url)
      audio.fire('playing')
      audio.fire('ended')
      expect(h.onStart).toHaveBeenCalledTimes(1)
      expect(h.onEnd).toHaveBeenCalledTimes(1)
    }
    cloud.prime()
    folio.prime()
    expect(audio.play).toHaveBeenCalledTimes(4)
  })
})

describe('UrlCache', () => {
  it('keeps the most recent entries, dropping the oldest', () => {
    const dropped: string[] = []
    const cache = new UrlCache<string>(2, (v) => dropped.push(v))
    cache.set('a', 'A')
    cache.set('b', 'B')
    expect(cache.get('a')).toBe('A')
    cache.set('c', 'C')
    expect(dropped).toEqual(['B'])
    expect(cache.peek('b')).toBeUndefined()
    expect(cache.get('zzz')).toBeUndefined()
    expect(cache.values()).toEqual(['A', 'C'])
    cache.deleteValue('A')
    cache.delete('c')
    expect(cache.length).toBe(0)
    cache.set('d', 'D')
    cache.clear()
    expect(dropped).toEqual(['B', 'D'])
  })
})
