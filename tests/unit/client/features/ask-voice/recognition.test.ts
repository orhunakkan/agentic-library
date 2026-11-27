import { describe, expect, it, vi } from 'vitest'
import {
  type Availability,
  browserRecognition,
  createRecognition,
  ERROR_GRACE_MS,
  heardText,
  INSTALL_TIMEOUT_MS,
  MAX_LISTEN_MS,
  type RecognitionCtor,
  type RecognitionLike,
  type RecognitionOptions,
  type ResultListLike,
  vendorOf,
} from '~/client/features/ask-voice/recognition'
import type { Timers } from '~/client/features/read-aloud/speaker'

function fakeTimers() {
  let now = 0
  let next = 0
  const due = new Map<number, { at: number; fn: () => void }>()
  const timers: Timers = {
    setTimeout: (fn, ms) => {
      const id = ++next
      due.set(id, { at: now + ms, fn })
      return id
    },
    clearTimeout: (id) => {
      due.delete(id as number)
    },
  }
  const run = (ms: number) => {
    const until = now + ms
    for (;;) {
      const first = [...due.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0]
      if (!first) break
      due.delete(first[0])
      now = first[1].at
      first[1].fn()
    }
    now = until
  }
  return { timers, run }
}

const results = (...items: [string, boolean][]): ResultListLike => {
  const list: ResultListLike = { length: items.length }
  items.forEach(([transcript, isFinal], i) => {
    list[i] = { isFinal, length: 1, 0: { transcript } }
  })
  return list
}

interface FakeRecognition extends RecognitionLike {
  calls: string[]
}

function fakeCtor(statics: {
  available?: (o: RecognitionOptions) => Promise<Availability>
  install?: (o: RecognitionOptions) => Promise<boolean>
  startThrows?: boolean
}) {
  const made: FakeRecognition[] = []
  class Fake implements FakeRecognition {
    lang = ''
    interimResults = false
    continuous = true
    maxAlternatives = 5
    processLocally?: boolean
    onresult: RecognitionLike['onresult'] = null
    onerror: RecognitionLike['onerror'] = null
    onend: RecognitionLike['onend'] = null
    calls: string[] = []
    constructor() {
      made.push(this)
    }
    start() {
      this.calls.push('start')
      if (statics.startThrows) throw new Error('InvalidStateError')
    }
    stop() {
      this.calls.push('stop')
    }
    abort() {
      this.calls.push('abort')
    }
  }
  const ctor = Fake as unknown as RecognitionCtor
  if (statics.available) ctor.available = statics.available
  if (statics.install) ctor.install = statics.install
  return { ctor, made }
}

const handlers = () => ({ onInterim: vi.fn(), onFinal: vi.fn(), onError: vi.fn() })

describe('mode', () => {
  const modeWith = (answers: { local: Availability | Error; online?: Availability | Error }) => {
    const available = vi.fn(async (o: RecognitionOptions) => {
      const answer = o.processLocally ? answers.local : (answers.online ?? 'unavailable')
      if (answer instanceof Error) throw answer
      return answer
    })
    const { ctor } = fakeCtor({ available })
    return { recognition: createRecognition({ ctor, timers: fakeTimers().timers }), available }
  }

  it('is local when the language is on the device, asking for the book’s language', async () => {
    const { recognition, available } = modeWith({ local: 'available' })
    expect(await recognition.mode('en-GB')).toBe('local')
    expect(available).toHaveBeenCalledWith({ langs: ['en-GB'], processLocally: true })
  })

  it('offers the download when the pack is downloadable or downloading', async () => {
    expect(await modeWith({ local: 'downloadable' }).recognition.mode('en')).toBe('downloadable')
    expect(await modeWith({ local: 'downloading' }).recognition.mode('en')).toBe('downloadable')
  })

  it('falls through to online when the device can’t, and to none when nothing can', async () => {
    expect(await modeWith({ local: 'unavailable', online: 'available' }).recognition.mode('en')).toBe('online')
    expect(await modeWith({ local: 'unavailable', online: 'unavailable' }).recognition.mode('en')).toBe('none')
    expect(await modeWith({ local: new SyntaxError('bad tag'), online: 'available' }).recognition.mode('xx')).toBe(
      'online',
    )
    expect(await modeWith({ local: 'unavailable', online: new Error('gone') }).recognition.mode('en')).toBe('none')
  })

  it('is online without available (Safari, older Chrome), as with only the webkit prefix', async () => {
    const { ctor } = fakeCtor({})
    const found = browserRecognition({ webkitSpeechRecognition: ctor })
    expect(found).toBe(ctor)
    expect(await createRecognition({ ctor: found as RecognitionCtor, timers: fakeTimers().timers }).mode('en')).toBe(
      'online',
    )
  })

  it('says whether online recognition exists beside the device’s', async () => {
    expect(await modeWith({ local: 'available', online: 'available' }).recognition.online('en')).toBe(true)
    expect(await modeWith({ local: 'available', online: 'unavailable' }).recognition.online('en')).toBe(false)
    expect(await modeWith({ local: 'available', online: new Error('x') }).recognition.online('en')).toBe(false)
    const { ctor } = fakeCtor({})
    expect(await createRecognition({ ctor, timers: fakeTimers().timers }).online('en')).toBe(true)
  })

  it('is asked once per language for the page’s life', async () => {
    const { recognition, available } = modeWith({ local: 'available' })
    await recognition.mode('en')
    await recognition.mode('en')
    expect(available).toHaveBeenCalledTimes(1)
    await recognition.mode('fr')
    expect(available).toHaveBeenCalledTimes(2)
  })
})

describe('browserRecognition', () => {
  it('prefers the unprefixed constructor, and is null without one', () => {
    const a = fakeCtor({}).ctor
    const b = fakeCtor({}).ctor
    expect(browserRecognition({ SpeechRecognition: a, webkitSpeechRecognition: b })).toBe(a)
    expect(browserRecognition({})).toBeNull()
    expect(browserRecognition({ SpeechRecognition: 'nope' })).toBeNull()
  })
})

describe('install', () => {
  const installWith = (install?: (o: RecognitionOptions) => Promise<boolean>) => {
    const clock = fakeTimers()
    const available = async () => 'downloadable' as const
    const { ctor } = fakeCtor({ available, ...(install ? { install } : {}) })
    return { recognition: createRecognition({ ctor, timers: clock.timers }), clock }
  }

  it('resolves true, asks for the language on the device, and makes the mode local', async () => {
    const install = vi.fn(async () => true)
    const { recognition } = installWith(install)
    expect(await recognition.mode('en')).toBe('downloadable')
    expect(await recognition.install('en')).toBe(true)
    expect(install).toHaveBeenCalledWith({ langs: ['en'], processLocally: true })
    expect(await recognition.mode('en')).toBe('local')
  })

  it('calls the browser at once, inside the press', () => {
    const install = vi.fn(() => new Promise<boolean>(() => {}))
    void installWith(install).recognition.install('en')
    expect(install).toHaveBeenCalledTimes(1)
  })

  it('resolves false for false, a rejection, a throw, or no install at all', async () => {
    expect(await installWith(async () => false).recognition.install('en')).toBe(false)
    expect(
      await installWith(() => Promise.reject(new DOMException('no', 'NotAllowedError'))).recognition.install('en'),
    ).toBe(false)
    expect(
      await installWith(() => {
        throw new Error('sync')
      }).recognition.install('en'),
    ).toBe(false)
    expect(await installWith().recognition.install('en')).toBe(false)
  })

  it('gives up after 3 minutes when the promise never settles', async () => {
    const { recognition, clock } = installWith(() => new Promise<boolean>(() => {}))
    const result = recognition.install('en')
    clock.run(INSTALL_TIMEOUT_MS - 1)
    let settled = false
    void result.then(() => (settled = true))
    await Promise.resolve()
    expect(settled).toBe(false)
    clock.run(1)
    expect(await result).toBe(false)
    expect(await recognition.mode('en')).toBe('downloadable')
  })
})

describe('listen', () => {
  const setup = (statics: Parameters<typeof fakeCtor>[0] = {}) => {
    const clock = fakeTimers()
    const { ctor, made } = fakeCtor(statics)
    return { recognition: createRecognition({ ctor, timers: clock.timers }), made, clock }
  }

  it('sets the language, interim results, one turn and one alternative, and starts', () => {
    const { recognition, made } = setup()
    recognition.listen('en-GB', { local: true, ...handlers() })
    const r = made[0] as FakeRecognition
    expect([r.lang, r.interimResults, r.continuous, r.maxAlternatives, r.processLocally]).toEqual([
      'en-GB',
      true,
      false,
      1,
      true,
    ])
    expect(r.calls).toEqual(['start'])
  })

  it('leaves processLocally to the browser online', () => {
    const { recognition, made } = setup()
    recognition.listen('en', { local: false, ...handlers() })
    expect(made[0]?.processLocally).toBeUndefined()
  })

  it('joins finals and the latest interim in order, in Chrome’s order: results, then end', () => {
    const { recognition, made } = setup()
    const h = handlers()
    recognition.listen('en', { local: true, ...h })
    const r = made[0] as FakeRecognition
    r.onresult?.({ results: results(['Who is', false]) })
    r.onresult?.({ results: results(['Who is Mr', false]) })
    r.onresult?.({ results: results(['Who is Mr Darcy?', true]) })
    expect(h.onInterim.mock.calls.map((c) => c[0])).toEqual(['Who is', 'Who is Mr', 'Who is Mr Darcy?'])
    expect(h.onFinal).not.toHaveBeenCalled()
    r.onend?.()
    expect(h.onFinal).toHaveBeenCalledWith('Who is Mr Darcy?')
    expect(heardText(results(['Who is', true], [' Mr  Darcy', false]))).toBe('Who is Mr Darcy')
  })

  it('in Safari’s order, end without a final result still sends what was heard', () => {
    const { recognition, made } = setup()
    const h = handlers()
    recognition.listen('en', { local: false, ...h })
    const r = made[0] as FakeRecognition
    r.onresult?.({ results: results(['What happens', false]) })
    r.onend?.()
    r.onresult?.({ results: results(['What happens next', true]) })
    expect(h.onFinal).toHaveBeenCalledTimes(1)
    expect(h.onFinal).toHaveBeenCalledWith('What happens')
  })

  it('stop() asks the browser to stop; what was heard is sent at end', () => {
    const { recognition, made } = setup()
    const h = handlers()
    const session = recognition.listen('en', { local: true, ...h })
    const r = made[0] as FakeRecognition
    r.onresult?.({ results: results(['Tell me', false]) })
    session.stop()
    expect(r.calls).toEqual(['start', 'stop'])
    r.onend?.()
    expect(h.onFinal).toHaveBeenCalledWith('Tell me')
  })

  it('end with nothing heard sends an empty question', () => {
    const { recognition, made } = setup()
    const h = handlers()
    recognition.listen('en', { local: true, ...h })
    made[0]?.onend?.()
    expect(h.onFinal).toHaveBeenCalledWith('')
  })

  it('abort() sends nothing, whatever the browser does after it', () => {
    const { recognition, made } = setup()
    const h = handlers()
    const session = recognition.listen('en', { local: true, ...h })
    const r = made[0] as FakeRecognition
    r.onresult?.({ results: results(['Never mind', false]) })
    session.abort()
    expect(r.calls).toEqual(['start', 'abort'])
    r.onerror?.({ error: 'aborted' })
    r.onend?.()
    session.stop()
    expect(h.onFinal).not.toHaveBeenCalled()
    expect(h.onError).not.toHaveBeenCalled()
  })

  it('stops by itself after 30 seconds of listening', () => {
    const { recognition, made, clock } = setup()
    recognition.listen('en', { local: true, ...handlers() })
    clock.run(MAX_LISTEN_MS - 1)
    expect(made[0]?.calls).toEqual(['start'])
    clock.run(1)
    expect(made[0]?.calls).toEqual(['start', 'stop'])
  })

  it('a second listen aborts the first', () => {
    const { recognition, made } = setup()
    const first = handlers()
    recognition.listen('en', { local: true, ...first })
    recognition.listen('en', { local: true, ...handlers() })
    expect(made[0]?.calls).toEqual(['start', 'abort'])
    made[0]?.onend?.()
    expect(first.onFinal).not.toHaveBeenCalled()
  })

  it.each([
    'no-speech',
    'audio-capture',
    'network',
    'not-allowed',
    'service-not-allowed',
    'language-not-supported',
    'phrases-not-supported',
  ])('passes on %s at end', (code) => {
    const { recognition, made } = setup()
    const h = handlers()
    recognition.listen('en', { local: true, ...h })
    made[0]?.onerror?.({ error: code })
    expect(h.onError).not.toHaveBeenCalled()
    made[0]?.onend?.()
    expect(h.onError).toHaveBeenCalledWith(code)
    expect(h.onFinal).not.toHaveBeenCalled()
  })

  it('an error without an end finishes after a moment', () => {
    const { recognition, made, clock } = setup()
    const h = handlers()
    recognition.listen('en', { local: true, ...h })
    made[0]?.onerror?.({ error: 'network' })
    clock.run(ERROR_GRACE_MS)
    expect(h.onError).toHaveBeenCalledWith('network')
    made[0]?.onend?.()
    expect(h.onError).toHaveBeenCalledTimes(1)
  })

  it('the browser’s own aborted shows nothing, and an error with no code is failed', () => {
    const { recognition, made } = setup()
    const h = handlers()
    recognition.listen('en', { local: true, ...h })
    made[0]?.onerror?.({ error: 'aborted' })
    made[0]?.onend?.()
    expect(h.onError).not.toHaveBeenCalled()
    expect(h.onFinal).not.toHaveBeenCalled()

    recognition.listen('en', { local: true, ...h })
    made[1]?.onerror?.({ error: '' })
    made[1]?.onend?.()
    expect(h.onError).toHaveBeenCalledWith('failed')
  })

  it('a start that throws fails the session', () => {
    const { recognition, clock } = setup({ startThrows: true })
    const h = handlers()
    recognition.listen('en', { local: true, ...h })
    clock.run(0)
    expect(h.onError).toHaveBeenCalledWith('failed')
  })
})

describe('vendorOf', () => {
  it.each([
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
      'Google',
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36',
      'Google',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0',
      'Microsoft',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1',
      'Apple',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/142.0 Mobile/15E148 Safari/604.1',
      'Apple',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15',
      'Apple',
    ],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:146.0) Gecko/20100101 Firefox/146.0', null],
    ['Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/142.0.0.0 Safari/537.36 OPR/120.0.0.0', null],
    ['curl/8.0', null],
  ])('%s is %s', (ua, vendor) => {
    expect(vendorOf(ua)).toBe(vendor)
  })
})
