import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type ArbiterDeps, createArbiter } from './arbitration'

function setup() {
  const loaded = { audiobook: false, voice: false }
  const deps = {
    audiobook: {
      loaded: () => loaded.audiobook,
      close: vi.fn(() => {
        loaded.audiobook = false
      }),
      pause: vi.fn(),
      fadeOut: vi.fn(),
    },
    voice: {
      loaded: () => loaded.voice,
      close: vi.fn(() => {
        loaded.voice = false
      }),
      stopAfterSentence: vi.fn(),
      setStopAtChapterEnd: vi.fn(),
    },
    aside: { interrupt: vi.fn() },
    onSleepEnded: vi.fn(),
    onChange: vi.fn(),
  } satisfies ArbiterDeps
  const arbiter = createArbiter(deps)
  return { arbiter, deps, loaded }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('one thing plays at a time', () => {
  it('an audiobook closes the voice and turns its timer off', () => {
    const { arbiter, deps, loaded } = setup()
    loaded.voice = true
    arbiter.setSleep(30)
    arbiter.beforeAudiobook()
    expect(deps.voice.close).toHaveBeenCalledOnce()
    expect(arbiter.state()).toMatchObject({ sleep: { kind: 'off' }, sleepChoice: 'off' })
  })

  it('an audiobook with no voice loaded closes nothing and keeps the timer', () => {
    const { arbiter, deps } = setup()
    arbiter.setSleep(30)
    arbiter.beforeAudiobook()
    expect(deps.voice.close).not.toHaveBeenCalled()
    expect(arbiter.state().sleepChoice).toBe(30)
  })

  it('the voice closes the audiobook and turns its timer off', () => {
    const { arbiter, deps, loaded } = setup()
    loaded.audiobook = true
    arbiter.setSleep(15)
    arbiter.beforeVoice()
    expect(deps.audiobook.close).toHaveBeenCalledOnce()
    expect(arbiter.state()).toMatchObject({ sleep: { kind: 'off' }, sleepChoice: 'off' })
  })

  it('the voice with no audiobook loaded closes nothing and keeps the timer', () => {
    const { arbiter, deps } = setup()
    arbiter.setSleep(15)
    arbiter.beforeVoice()
    expect(deps.audiobook.close).not.toHaveBeenCalled()
    expect(arbiter.state().sleepChoice).toBe(15)
  })

  it('the aside pauses the audiobook, leaves it loaded and keeps the timer', () => {
    const { arbiter, deps, loaded } = setup()
    loaded.audiobook = true
    arbiter.setSleep(45)
    arbiter.beforeAside()
    expect(deps.audiobook.pause).toHaveBeenCalledOnce()
    expect(deps.audiobook.close).not.toHaveBeenCalled()
    expect(arbiter.state().sleepChoice).toBe(45)
  })

  it.each(['audiobook', 'voice'] as const)('the %s starting to play interrupts the aside', (source) => {
    const { arbiter, deps } = setup()
    arbiter.playing(source, true)
    expect(deps.aside.interrupt).toHaveBeenCalledOnce()
    arbiter.playing(source, false)
    expect(deps.aside.interrupt).toHaveBeenCalledOnce()
  })

  it('says whether something plays', () => {
    const { arbiter, deps } = setup()
    arbiter.playing('voice', true)
    expect(arbiter.state().playing).toBe(true)
    expect(deps.onChange).toHaveBeenLastCalledWith(expect.objectContaining({ playing: true }))
    arbiter.playing('voice', false)
    expect(arbiter.state().playing).toBe(false)
  })

  it('closing turns the timer off', () => {
    const { arbiter } = setup()
    arbiter.setSleep(60)
    arbiter.closed()
    expect(arbiter.state()).toMatchObject({ sleep: { kind: 'off' }, sleepChoice: 'off' })
  })
})

describe('the sleep timer', () => {
  it('counts the minutes only while something plays', () => {
    const { arbiter } = setup()
    arbiter.setSleep(15)
    vi.advanceTimersByTime(5000)
    expect(arbiter.state().sleep).toEqual({ kind: 'minutes', leftMs: 15 * 60_000 })
    arbiter.playing('audiobook', true)
    vi.advanceTimersByTime(3000)
    expect(arbiter.state().sleep).toEqual({ kind: 'minutes', leftMs: 15 * 60_000 - 3000 })
    arbiter.playing('audiobook', false)
    vi.advanceTimersByTime(60_000)
    expect(arbiter.state().sleep).toEqual({ kind: 'minutes', leftMs: 15 * 60_000 - 3000 })
  })

  it('ticks once a second however often playing is reported', () => {
    const { arbiter } = setup()
    arbiter.setSleep(15)
    arbiter.playing('voice', true)
    arbiter.playing('voice', true)
    vi.advanceTimersByTime(2000)
    expect(arbiter.state().sleep).toEqual({ kind: 'minutes', leftMs: 15 * 60_000 - 2000 })
  })

  it('ends an audiobook with the toast, then the fade', () => {
    const { arbiter, deps, loaded } = setup()
    loaded.audiobook = true
    arbiter.setSleep(15)
    arbiter.playing('audiobook', true)
    vi.advanceTimersByTime(15 * 60_000 - 1000)
    expect(deps.onSleepEnded).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(deps.onSleepEnded).toHaveBeenCalledOnce()
    expect(deps.audiobook.fadeOut).toHaveBeenCalledOnce()
    expect(deps.onSleepEnded.mock.invocationCallOrder[0]).toBeLessThan(
      deps.audiobook.fadeOut.mock.invocationCallOrder[0] ?? 0,
    )
    expect(arbiter.state()).toMatchObject({ sleep: { kind: 'off' }, sleepChoice: 'off' })
    vi.advanceTimersByTime(60_000)
    expect(deps.onSleepEnded).toHaveBeenCalledOnce()
  })

  it('stops the voice after its sentence, and toasts only when the voice has slept', () => {
    const { arbiter, deps, loaded } = setup()
    loaded.voice = true
    arbiter.setSleep(15)
    arbiter.playing('voice', true)
    vi.advanceTimersByTime(15 * 60_000)
    expect(deps.voice.stopAfterSentence).toHaveBeenCalledOnce()
    expect(arbiter.state().sleep).toEqual({ kind: 'off' })
    expect(deps.onSleepEnded).not.toHaveBeenCalled()
    arbiter.voiceSlept()
    expect(deps.onSleepEnded).toHaveBeenCalledOnce()
    expect(arbiter.state().sleepChoice).toBe('off')
  })

  it('end of part tells the voice to stop at the chapter end, and Off takes it back', () => {
    const { arbiter, deps } = setup()
    arbiter.setSleep('end-of-part')
    expect(deps.voice.setStopAtChapterEnd).toHaveBeenLastCalledWith(true)
    arbiter.setSleep('off')
    expect(deps.voice.setStopAtChapterEnd).toHaveBeenLastCalledWith(false)
  })

  it('end of part is taken back when another source turns the timer off', () => {
    const { arbiter, deps, loaded } = setup()
    loaded.audiobook = true
    arbiter.setSleep('end-of-part')
    arbiter.beforeVoice()
    expect(deps.voice.setStopAtChapterEnd).toHaveBeenLastCalledWith(false)
  })

  it("stops at an episode's end with end of part set, toasting once", () => {
    const { arbiter, deps } = setup()
    expect(arbiter.partEnded()).toBe('continue')
    expect(deps.onSleepEnded).not.toHaveBeenCalled()
    arbiter.setSleep('end-of-part')
    expect(arbiter.partEnded()).toBe('stop')
    expect(deps.onSleepEnded).toHaveBeenCalledOnce()
    expect(arbiter.state()).toMatchObject({ sleep: { kind: 'off' }, sleepChoice: 'off' })
    expect(arbiter.partEnded()).toBe('continue')
    expect(deps.onSleepEnded).toHaveBeenCalledOnce()
  })

  it('stops ticking once disposed', () => {
    const { arbiter } = setup()
    arbiter.setSleep(15)
    arbiter.playing('audiobook', true)
    arbiter.dispose()
    vi.advanceTimersByTime(5000)
    expect(arbiter.state().sleep).toEqual({ kind: 'minutes', leftMs: 15 * 60_000 })
  })
})
