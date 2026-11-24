import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type ArbiterDeps, createArbiter } from './arbitration'

function setup() {
  const loaded = { audiobook: false, readAloud: false }
  const deps = {
    audiobook: {
      loaded: () => loaded.audiobook,
      close: vi.fn(() => {
        loaded.audiobook = false
      }),
      pause: vi.fn(),
      fadeOut: vi.fn(),
    },
    readAloud: {
      loaded: () => loaded.readAloud,
      close: vi.fn(() => {
        loaded.readAloud = false
      }),
      pause: vi.fn(),
      stopAfterSentence: vi.fn(),
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
  it('an audiobook closes read aloud and turns its timer off', () => {
    const { arbiter, deps, loaded } = setup()
    loaded.readAloud = true
    arbiter.setSleep(30)
    arbiter.beforeAudiobook()
    expect(deps.readAloud.close).toHaveBeenCalledOnce()
    expect(arbiter.state()).toMatchObject({ sleep: { kind: 'off' }, sleepChoice: 'off' })
  })

  it('an audiobook with no read aloud loaded closes nothing and keeps the timer', () => {
    const { arbiter, deps } = setup()
    arbiter.setSleep(30)
    arbiter.beforeAudiobook()
    expect(deps.readAloud.close).not.toHaveBeenCalled()
    expect(arbiter.state().sleepChoice).toBe(30)
  })

  it('read aloud closes the audiobook and turns its timer off', () => {
    const { arbiter, deps, loaded } = setup()
    loaded.audiobook = true
    arbiter.setSleep(15)
    arbiter.beforeReadAloud()
    expect(deps.audiobook.close).toHaveBeenCalledOnce()
    expect(arbiter.state()).toMatchObject({ sleep: { kind: 'off' }, sleepChoice: 'off' })
  })

  it('read aloud with no audiobook loaded closes nothing and keeps the timer', () => {
    const { arbiter, deps } = setup()
    arbiter.setSleep(15)
    arbiter.beforeReadAloud()
    expect(deps.audiobook.close).not.toHaveBeenCalled()
    expect(arbiter.state().sleepChoice).toBe(15)
  })

  it('the aside pauses both sources, leaves them loaded and keeps the timer', () => {
    const { arbiter, deps, loaded } = setup()
    loaded.audiobook = true
    loaded.readAloud = true
    arbiter.setSleep(45)
    arbiter.beforeAside()
    expect(deps.audiobook.pause).toHaveBeenCalledOnce()
    expect(deps.readAloud.pause).toHaveBeenCalledOnce()
    expect(deps.audiobook.close).not.toHaveBeenCalled()
    expect(deps.readAloud.close).not.toHaveBeenCalled()
    expect(arbiter.state().sleepChoice).toBe(45)
  })

  it.each(['audiobook', 'read-aloud'] as const)('the %s starting to play interrupts the aside', (source) => {
    const { arbiter, deps } = setup()
    arbiter.playing(source, true)
    expect(deps.aside.interrupt).toHaveBeenCalledOnce()
    arbiter.playing(source, false)
    expect(deps.aside.interrupt).toHaveBeenCalledOnce()
  })

  it('says whether something plays', () => {
    const { arbiter, deps } = setup()
    arbiter.playing('read-aloud', true)
    expect(arbiter.state().playing).toBe(true)
    expect(deps.onChange).toHaveBeenLastCalledWith(expect.objectContaining({ playing: true }))
    arbiter.playing('read-aloud', false)
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
    arbiter.playing('read-aloud', true)
    arbiter.playing('read-aloud', true)
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

  it('stops read aloud after its sentence, and toasts only when read aloud has slept', () => {
    const { arbiter, deps, loaded } = setup()
    loaded.readAloud = true
    arbiter.setSleep(15)
    arbiter.playing('read-aloud', true)
    vi.advanceTimersByTime(15 * 60_000)
    expect(deps.readAloud.stopAfterSentence).toHaveBeenCalledOnce()
    expect(arbiter.state().sleep).toEqual({ kind: 'off' })
    expect(deps.onSleepEnded).not.toHaveBeenCalled()
    arbiter.readAloudSlept()
    expect(deps.onSleepEnded).toHaveBeenCalledOnce()
    expect(arbiter.state().sleepChoice).toBe('off')
  })

  it('stops at the end of a part with end of part set, toasting once', () => {
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
