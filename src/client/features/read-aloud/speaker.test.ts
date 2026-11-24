import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSpeaker, type Speaker, speakersFor, type Utterance, type UtteranceLike, watchdogMs } from './speaker'
import type { VoiceLike } from './voices'

function fakeSynth() {
  const spoken: UtteranceLike[] = []
  const calls: string[] = []
  return {
    spoken,
    calls,
    synth: {
      speak: (u: never) => {
        calls.push('speak')
        spoken.push(u)
      },
      cancel: () => calls.push('cancel'),
    },
    last: () => spoken.at(-1) as UtteranceLike,
  }
}

const makeUtterance = (text: string): UtteranceLike => ({
  text,
  lang: '',
  rate: 1,
  voice: null,
  onstart: null,
  onend: null,
  onerror: null,
})

const voice = { name: 'Samantha', voiceURI: 'samantha', lang: 'en-US' } as SpeechSynthesisVoice

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('createSpeaker', () => {
  it('cancels before each speak, and sets the text, language, rate and voice', () => {
    const fake = fakeSynth()
    const speaker = createSpeaker(fake.synth, makeUtterance)
    speaker.speak('Hello there.', { lang: 'en', rate: 1.5, voice, ahead: [] }, { onEnd: vi.fn(), onError: vi.fn() })
    expect(fake.calls).toEqual(['cancel', 'speak'])
    expect(fake.last()).toMatchObject({ text: 'Hello there.', lang: 'en', rate: 1.5, voice })
  })

  it('reports the start and end of the utterance it is speaking', () => {
    const fake = fakeSynth()
    const speaker = createSpeaker(fake.synth, makeUtterance)
    const handlers = { onStart: vi.fn(), onEnd: vi.fn(), onError: vi.fn() }
    speaker.speak('One.', { lang: 'en', rate: 1, voice: null, ahead: [] }, handlers)
    fake.last().onstart?.({})
    fake.last().onend?.({})
    fake.last().onend?.({})
    expect(handlers.onStart).toHaveBeenCalledOnce()
    expect(handlers.onEnd).toHaveBeenCalledOnce()
    expect(handlers.onError).not.toHaveBeenCalled()
  })

  it('speaks one utterance at a time: a replaced or stopped one reports nothing', () => {
    const fake = fakeSynth()
    const speaker = createSpeaker(fake.synth, makeUtterance)
    const first = { onStart: vi.fn(), onEnd: vi.fn(), onError: vi.fn() }
    const second = { onEnd: vi.fn(), onError: vi.fn() }
    speaker.speak('One.', { lang: 'en', rate: 1, voice: null, ahead: [] }, first)
    const old = fake.last()
    speaker.speak('Two.', { lang: 'en', rate: 1, voice: null, ahead: [] }, second)
    old.onerror?.({ error: 'interrupted' })
    old.onend?.({})
    old.onstart?.({})
    expect(first.onEnd).not.toHaveBeenCalled()
    expect(first.onError).not.toHaveBeenCalled()
    expect(first.onStart).not.toHaveBeenCalled()
    speaker.stop()
    fake.last().onend?.({})
    expect(second.onEnd).not.toHaveBeenCalled()
    expect(fake.calls).toEqual(['cancel', 'speak', 'cancel', 'speak', 'cancel'])
  })

  it('reports an error as a failed utterance', () => {
    const fake = fakeSynth()
    const speaker = createSpeaker(fake.synth, makeUtterance)
    const handlers = { onEnd: vi.fn(), onError: vi.fn() }
    speaker.speak('One.', { lang: 'en', rate: 1, voice: null, ahead: [] }, handlers)
    fake.last().onerror?.({ error: 'synthesis-failed' })
    speaker.speak('Two.', { lang: 'en', rate: 1, voice: null, ahead: [] }, handlers)
    fake.last().onerror?.({})
    expect(handlers.onError.mock.calls).toEqual([[{ kind: 'failed' }], [{ kind: 'failed' }]])
  })

  it('has nothing to prime or close', () => {
    const fake = fakeSynth()
    const speaker = createSpeaker(fake.synth, makeUtterance)
    const handlers = { onEnd: vi.fn(), onError: vi.fn() }
    speaker.speak('One.', { lang: 'en', rate: 1, voice: null, ahead: [] }, handlers)
    speaker.prime()
    speaker.close()
    expect(fake.calls).toEqual(['cancel', 'speak'])
  })

  it('gives up on an utterance that never finishes, after its length at 8 characters a second plus 5 seconds', () => {
    const fake = fakeSynth()
    const speaker = createSpeaker(fake.synth, makeUtterance)
    const handlers = { onEnd: vi.fn(), onError: vi.fn() }
    const text = 'x'.repeat(80)
    expect(watchdogMs(text, 1)).toBe(15_000)
    expect(watchdogMs(text, 2)).toBe(10_000)
    speaker.speak(text, { lang: 'en', rate: 2, voice: null, ahead: [] }, handlers)
    vi.advanceTimersByTime(9_999)
    expect(handlers.onError).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(handlers.onError).toHaveBeenCalledWith({ kind: 'failed' })
    expect(fake.calls.at(-1)).toBe('cancel')
    fake.last().onend?.({})
    expect(handlers.onEnd).not.toHaveBeenCalled()
  })

  it('clears the watchdog when the utterance ends in time, or is stopped', () => {
    const fake = fakeSynth()
    const speaker = createSpeaker(fake.synth, makeUtterance)
    const handlers = { onEnd: vi.fn(), onError: vi.fn() }
    speaker.speak('Short.', { lang: 'en', rate: 1, voice: null, ahead: [] }, handlers)
    fake.last().onend?.({})
    speaker.speak('Short.', { lang: 'en', rate: 1, voice: null, ahead: [] }, handlers)
    speaker.stop()
    vi.advanceTimersByTime(60_000)
    expect(handlers.onError).not.toHaveBeenCalled()
    expect(handlers.onEnd).toHaveBeenCalledOnce()
  })
})

describe('speakersFor', () => {
  const fakeSpeaker = (): Speaker => ({ speak: vi.fn(), stop: vi.fn(), prime: vi.fn(), close: vi.fn() })
  const voiceOf = (engine: VoiceLike['engine']): VoiceLike => ({
    name: 'Amy',
    lang: 'en-US',
    voiceURI: 'amy',
    localService: true,
    default: false,
    engine,
  })

  it('lists every speaker it has', () => {
    const device = fakeSpeaker()
    const cloud = fakeSpeaker()
    const folio = fakeSpeaker()
    expect(speakersFor({ device }).all).toEqual([device])
    expect(speakersFor({ device, cloud, folio }).all).toEqual([device, cloud, folio])
  })

  it('speaks a device voice, or no voice, with the device speaker', () => {
    const device = fakeSpeaker()
    const { speakerFor } = speakersFor({ device, cloud: fakeSpeaker(), folio: fakeSpeaker() })
    expect(speakerFor(voiceOf('device'))).toBe(device)
    expect(speakerFor(null)).toBe(device)
  })

  it('speaks a cloud voice with the cloud speaker, or the device speaker when there is none', () => {
    const device = fakeSpeaker()
    const cloud = fakeSpeaker()
    expect(speakersFor({ device, cloud }).speakerFor(voiceOf('cloud'))).toBe(cloud)
    expect(speakersFor({ device }).speakerFor(voiceOf('cloud'))).toBe(device)
  })

  it('speaks a Folio voice with the Folio speaker, or the device speaker when there is none', () => {
    const device = fakeSpeaker()
    const folio = fakeSpeaker()
    expect(speakersFor({ device, folio }).speakerFor(voiceOf('local'))).toBe(folio)
    expect(speakersFor({ device }).speakerFor(voiceOf('local'))).toBe(device)
  })
})

describe('Utterance', () => {
  it('has its text, its place in the book, or both, never neither', () => {
    const ref = { book: 'pride-and-prejudice', chapter: 1, intro: true } as const
    const said: Utterance[] = [{ text: 'Hi.' }, { ref }, { text: 'Hi.', ref }]
    // @ts-expect-error an utterance with neither text nor a place in the book says nothing
    const empty: Utterance = {}
    expect([...said, empty]).toHaveLength(4)
  })
})
