import { describe, expect, it, vi } from 'vitest'
import { FOLIO_VOICES } from '~/shared/read-aloud/folio-voices'
import { createAside, forwardAside } from './aside'
import { rememberVoice, SPEED_KEY, voiceChoiceKey } from './position-store'
import type { Speaker, SpeakHandlers, SpeakOptions } from './speaker'
import type { VoiceLike } from './voices'

const voice = (name: string, extra: Partial<VoiceLike> = {}): VoiceLike => ({
  name,
  lang: 'en-GB',
  voiceURI: name,
  localService: true,
  default: false,
  ...extra,
})

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  }
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
}

function fakeSpeaker(engine: string) {
  const said: { text: string; options: SpeakOptions; engine: string }[] = []
  let handlers: SpeakHandlers | null = null
  let stops = 0
  const primes = { count: 0 }
  const speaker: Speaker = {
    speak: (text, options, h) => {
      said.push({ text, options, engine })
      handlers = h
    },
    stop: () => {
      stops++
      handlers = null
    },
    prime: () => void primes.count++,
    close: () => {},
  }
  return {
    speaker,
    said,
    primes,
    stops: () => stops,
    end: async () => {
      const h = handlers
      handlers = null
      h?.onEnd()
      await flush()
    },
    fail: async () => {
      const h = handlers
      handlers = null
      h?.onError({ kind: 'failed' })
      await flush()
    },
  }
}

const cori = FOLIO_VOICES.find((v) => v.id === 'en_GB-cori-medium')

function setup(options: { voices?: VoiceLike[]; downloaded?: typeof FOLIO_VOICES; storage?: Storage } = {}) {
  const device = fakeSpeaker('device')
  const local = fakeSpeaker('local')
  const pauseBook = vi.fn()
  const storage = options.storage ?? memoryStorage()
  const aside = createAside({
    speaker: device.speaker,
    localSpeaker: local.speaker,
    loadVoices: async () => options.voices ?? [voice('Device'), voice('Online (Natural)', { localService: false })],
    downloaded: async () => options.downloaded ?? [],
    storage,
    locale: 'en-GB',
    pauseBook,
  })
  const handlers = { onIdle: vi.fn(), onFailed: vi.fn(), onInterrupted: vi.fn() }
  const book = { lang: 'en-GB', privateBook: false }
  return { aside, device, local, pauseBook, storage, handlers, book }
}

describe('voiceFor', () => {
  it('picks the automatic voice, a downloaded Folio voice first', async () => {
    expect((await setup().aside.voiceFor('en-GB', false)).voice?.name).toBe('Online (Natural)')
    expect((await setup().aside.voiceFor('en-GB', true)).voice?.name).toBe('Device')
    const withCori = setup({ downloaded: cori ? [cori] : [] })
    expect((await withCori.aside.voiceFor('en-GB', false)).voice?.voiceURI).toBe('folio:en_GB-cori-medium')
  })

  it('keeps the remembered choice for the language, apart for private books', async () => {
    const t = setup()
    rememberVoice(t.storage, voiceChoiceKey('en', false), 'Device')
    expect(await t.aside.voiceFor('en-GB', false)).toEqual({
      voice: expect.objectContaining({ name: 'Device' }),
      skippedCloud: false,
    })
  })

  it('passes over a remembered ElevenLabs voice, and says so', async () => {
    const t = setup()
    rememberVoice(t.storage, voiceChoiceKey('en', true), 'elevenlabs:abc')
    const picked = await t.aside.voiceFor('en-GB', true)
    expect(picked.skippedCloud).toBe(true)
    expect(picked.voice?.name).toBe('Device')
  })

  it('has no voice when the device can’t say the language, and still lists the browser default case', async () => {
    expect((await setup({ voices: [] }).aside.voiceFor('en-GB', false)).voice).toBeNull()
  })
})

describe('voiceFor when the lists fail', () => {
  it('has no voice, and says nothing failed, when neither list loads', async () => {
    const aside = createAside({
      speaker: fakeSpeaker('device').speaker,
      localSpeaker: fakeSpeaker('local').speaker,
      loadVoices: () => Promise.reject(new Error('no voices')),
      downloaded: () => Promise.reject(new Error('no cache')),
      storage: null,
      pauseBook: () => {},
    })
    expect(await aside.voiceFor('en-GB', false)).toEqual({ voice: null, skippedCloud: false })
  })
})

describe('say', () => {
  it('holds the book, then says each utterance in turn at the read-aloud speed', async () => {
    const t = setup()
    t.storage.setItem(SPEED_KEY, '1.5')
    t.aside.say(['One.', 'Two.'], t.book, t.handlers)
    expect(t.pauseBook).toHaveBeenCalled()
    await flush()
    expect(t.device.said.map((s) => [s.text, s.options.rate, s.options.voice?.name])).toEqual([
      ['One.', 1.5, 'Online (Natural)'],
    ])
    await t.device.end()
    expect(t.device.said.map((s) => s.text)).toEqual(['One.', 'Two.'])
    expect(t.handlers.onIdle).not.toHaveBeenCalled()
    await t.device.end()
    expect(t.handlers.onIdle).toHaveBeenCalledTimes(1)
    expect(t.aside.active()).toBe(true)
  })

  it('goes on with utterances appended while it speaks, and after it went idle', async () => {
    const t = setup()
    t.aside.say(['One.'], t.book, t.handlers)
    await flush()
    t.aside.append(['Two.'])
    t.aside.append([])
    await t.device.end()
    await t.device.end()
    expect(t.handlers.onIdle).toHaveBeenCalledTimes(1)
    t.aside.append(['Three.'])
    expect(t.device.said.map((s) => s.text)).toEqual(['One.', 'Two.', 'Three.'])
  })

  it('speaks a Folio voice on the local speaker, with the next two to make ahead', async () => {
    const t = setup({ downloaded: cori ? [cori] : [] })
    t.aside.say(['One.', 'Two.', 'Three.', 'Four.'], t.book, t.handlers)
    await flush()
    expect(t.device.said).toEqual([])
    expect(t.local.said[0]?.text).toBe('One.')
    expect(t.local.said[0]?.options.ahead).toEqual([{ text: 'Two.' }, { text: 'Three.' }])
  })

  it('skips a failed utterance, and stops after three in a row', async () => {
    const t = setup()
    t.aside.say(['A.', 'B.', 'C.', 'D.', 'E.'], t.book, t.handlers)
    await flush()
    await t.device.fail()
    await t.device.end()
    await t.device.fail()
    await t.device.fail()
    expect(t.handlers.onFailed).not.toHaveBeenCalled()
    await t.device.fail()
    expect(t.handlers.onFailed).toHaveBeenCalledTimes(1)
    expect(t.device.said.map((s) => s.text)).toEqual(['A.', 'B.', 'C.', 'D.', 'E.'])
    expect(t.aside.active()).toBe(false)
  })

  it('a new say replaces the old one', async () => {
    const t = setup()
    t.aside.say(['Old.'], t.book, t.handlers)
    await flush()
    const other = { onIdle: vi.fn(), onFailed: vi.fn(), onInterrupted: vi.fn() }
    t.aside.say(['New.'], t.book, other)
    await flush()
    await t.device.end()
    expect(t.device.said.map((s) => s.text)).toEqual(['Old.', 'New.'])
    expect(other.onIdle).toHaveBeenCalled()
    expect(t.handlers.onIdle).not.toHaveBeenCalled()
  })
})

describe('forwardAside', () => {
  it('forwards each call to the aside there is now, and does nothing without one', async () => {
    let current: ReturnType<typeof createAside> | null = null
    const forward = forwardAside(() => current)
    expect(await forward.voiceFor('en', false)).toEqual({ voice: null, skippedCloud: false })
    expect(forward.active()).toBe(false)
    const handlers = { onIdle: vi.fn(), onFailed: vi.fn(), onInterrupted: vi.fn() }
    forward.hush()
    forward.say(['x'], { lang: 'en', privateBook: false }, handlers)
    forward.append(['y'])
    forward.stop()
    forward.interrupt()
    const t = setup()
    current = t.aside
    expect((await forward.voiceFor('en-GB', false)).voice?.name).toBe('Online (Natural)')
    forward.hush()
    expect(t.pauseBook).toHaveBeenCalledTimes(1)
    forward.say(['One.'], t.book, handlers)
    expect(forward.active()).toBe(true)
    await flush()
    forward.append(['Two.'])
    forward.interrupt()
    expect(handlers.onInterrupted).toHaveBeenCalledTimes(1)
    forward.say(['Three.'], t.book, handlers)
    forward.stop()
    expect(forward.active()).toBe(false)
  })
})

describe('stopping', () => {
  it('stop() silences both speakers and calls nothing after', async () => {
    const t = setup()
    t.aside.say(['One.', 'Two.'], t.book, t.handlers)
    await flush()
    t.aside.stop()
    expect(t.device.stops()).toBeGreaterThan(0)
    expect(t.local.stops()).toBeGreaterThan(0)
    await t.device.end()
    expect(t.handlers.onIdle).not.toHaveBeenCalled()
    expect(t.aside.active()).toBe(false)
    t.aside.append(['Three.'])
    expect(t.device.said.map((s) => s.text)).toEqual(['One.'])
  })

  it('stop() before the voice is known says nothing', async () => {
    const t = setup()
    t.aside.say(['One.'], t.book, t.handlers)
    t.aside.stop()
    await flush()
    expect(t.device.said).toEqual([])
  })

  it('interrupt() hands the speaker to the book and says so, once', async () => {
    const t = setup()
    t.aside.say(['One.'], t.book, t.handlers)
    await flush()
    const stops = t.device.stops()
    t.aside.interrupt()
    t.aside.interrupt()
    expect(t.handlers.onInterrupted).toHaveBeenCalledTimes(1)
    expect(t.device.stops()).toBe(stops)
  })

  it('hush() holds the book and readies the speech element', () => {
    const t = setup()
    t.aside.hush()
    expect(t.pauseBook).toHaveBeenCalledTimes(1)
    expect(t.local.primes.count).toBe(1)
  })
})
