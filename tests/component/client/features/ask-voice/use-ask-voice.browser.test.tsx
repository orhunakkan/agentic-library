import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { useAsk } from '~/client/features/ask/use-ask'
import type { RecognitionLike, ResultListLike } from '~/client/features/ask-voice/recognition'
import { type AskVoiceOptions, useAskVoice } from '~/client/features/ask-voice/use-ask-voice'
import { ELEVENLABS_SEEN_KEY, ONLINE_KEY, SPEAK_KEY } from '~/client/features/ask-voice/voice-prefs'
import type { Aside } from '~/client/features/read-aloud/aside'
import { mountHook } from '../../../../support/client/mount'

type AskState = ReturnType<typeof useAsk>

/**
 * The hook speaks through the player's read-aloud aside, which needs the whole player; here the player is a stand-in
 * that hands over an aside whose calls the tests read.
 */
const player = vi.hoisted(() => ({ readAloud: { supported: true, aside: null as Aside | null } }))
vi.mock('~/client/features/player/PlayerProvider', () => ({ usePlayer: () => player }))

function fakeAside(): Aside {
  return {
    voiceFor: vi.fn(async () => ({ voice: null, skippedCloud: false })),
    hush: vi.fn(),
    say: vi.fn(),
    append: vi.fn(),
    stop: vi.fn(),
    interrupt: vi.fn(),
    active: vi.fn(() => false),
  }
}

/**
 * Headless Chromium has a speech recognition constructor but no microphone or speech service behind it, so each test
 * puts a stand-in in its place. It says on-device recognition is available, and keeps every recognition it makes so
 * the test can speak into it.
 */
function stubRecognition() {
  const made: FakeRecognition[] = []
  class FakeRecognition implements RecognitionLike {
    lang = ''
    interimResults = false
    continuous = false
    maxAlternatives = 1
    processLocally?: boolean
    onresult: RecognitionLike['onresult'] = null
    onerror: RecognitionLike['onerror'] = null
    onend: RecognitionLike['onend'] = null
    start = vi.fn()
    stop = vi.fn(() => this.onend?.())
    abort = vi.fn()
    static available = async () => 'available' as const
    constructor() {
      made.push(this)
    }
  }
  vi.stubGlobal('SpeechRecognition', FakeRecognition)
  return made
}

/** What a recognition hands over once it has heard `transcript` in full. */
const heard = (transcript: string): { results: ResultListLike } => ({
  results: { length: 1, 0: { isFinal: true, length: 1, 0: { transcript } } },
})

function askState(patch: Partial<AskState> = {}): AskState {
  return {
    thread: { v: 1, wholeBook: false, turns: [] },
    pending: null,
    failure: null,
    ask: vi.fn(),
    stop: vi.fn(),
    retry: vi.fn(),
    clear: vi.fn(),
    setWholeBook: vi.fn(),
    pick: vi.fn(),
    busy: false,
    ...patch,
  }
}

function options(patch: Partial<AskVoiceOptions> = {}): AskVoiceOptions {
  return { ask: askState(), lang: 'fr', privateBook: false, active: true, send: vi.fn(), ...patch }
}

/** Presses Escape on the page, and says whether something took it. */
function pressEscape(): boolean {
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  document.body.dispatchEvent(event)
  return event.defaultPrevented
}

describe('useAskVoice', () => {
  beforeEach(() => {
    player.readAloud = { supported: true, aside: fakeAside() }
    for (const key of [ONLINE_KEY, SPEAK_KEY, ELEVENLABS_SEEN_KEY]) localStorage.removeItem(key)
  })

  it("starts idle, and says what the browser supports and the book's language", async () => {
    stubRecognition()
    const hook = mountHook(useAskVoice, options())
    expect(hook.current.turn.phase).toBe('idle')
    expect(hook.current.language).toBe('French')
    expect(hook.current.canListen).toBe(true)
    await expect.poll(() => hook.current.supported).toBe(true)
    expect(hook.current.vendor).toBe('Google')
  })

  it('says listening is not supported, and does nothing on a press, where the browser has no recognition', async () => {
    vi.stubGlobal('SpeechRecognition', undefined)
    vi.stubGlobal('webkitSpeechRecognition', undefined)
    const hook = mountHook(useAskVoice, options())
    await expect.poll(() => hook.current.vendor).toBe('Google')
    expect(hook.current.supported).toBe(false)
    hook.current.press()
    expect(hook.current.turn.phase).toBe('idle')
    expect(player.readAloud.aside?.hush).not.toHaveBeenCalled()
  })

  it("listens in the book's language on a press, and sends what it heard", async () => {
    const made = stubRecognition()
    const send = vi.fn()
    const hook = mountHook(useAskVoice, options({ send }))
    hook.current.press()
    await expect.poll(() => hook.current.turn.phase).toBe('listening')
    const recognition = made[0]
    expect(recognition?.lang).toBe('fr')
    expect(recognition?.processLocally).toBe(true)
    expect(recognition?.start).toHaveBeenCalledOnce()
    recognition?.onresult?.(heard('what is this'))
    await expect.poll(() => hook.current.turn.heard).toBe('what is this')
    recognition?.onend?.()
    await expect.poll(() => hook.current.turn.phase).toBe('sending')
    expect(send).toHaveBeenCalledExactlyOnceWith('what is this')
  })

  it('sends with the send it was given last', async () => {
    const made = stubRecognition()
    const first = vi.fn()
    const latest = vi.fn()
    const hook = mountHook(useAskVoice, options({ send: first }))
    hook.current.press()
    await expect.poll(() => hook.current.turn.phase).toBe('listening')
    hook.rerender(options({ send: latest }))
    made[0]?.onresult?.(heard('who wrote it'))
    made[0]?.onend?.()
    await expect.poll(() => hook.current.turn.phase).toBe('sending')
    expect(first).not.toHaveBeenCalled()
    expect(latest).toHaveBeenCalledExactlyOnceWith('who wrote it')
  })

  it('fails the spoken question at once when an answer is still coming', async () => {
    const made = stubRecognition()
    const send = vi.fn()
    const hook = mountHook(useAskVoice, options({ send, ask: askState({ busy: true }) }))
    hook.current.press()
    await expect.poll(() => hook.current.turn.phase).toBe('listening')
    made[0]?.onresult?.(heard('and then'))
    made[0]?.onend?.()
    await expect.poll(() => hook.current.turn.phase).toBe('idle')
    expect(send).not.toHaveBeenCalled()
  })

  it('goes back to idle when the answer it sent for fails', async () => {
    const made = stubRecognition()
    const ask = askState()
    const hook = mountHook(useAskVoice, options({ ask }))
    hook.current.press()
    await expect.poll(() => hook.current.turn.phase).toBe('listening')
    made[0]?.onresult?.(heard('what next'))
    made[0]?.onend?.()
    await expect.poll(() => hook.current.turn.phase).toBe('sending')
    const failure = {
      problem: 'failed' as const,
      question: 'what next',
      quote: null,
      highlights: false,
      action: null,
      prompt: null,
    }
    hook.rerender(options({ ask: { ...ask, failure } }))
    await expect.poll(() => hook.current.turn.phase).toBe('idle')
  })

  it('stops listening on Escape, and leaves Escape alone when it is not listening', async () => {
    const made = stubRecognition()
    const hook = mountHook(useAskVoice, options())
    expect(pressEscape()).toBe(false)
    hook.current.press()
    await expect.poll(() => hook.current.turn.phase).toBe('listening')
    expect(pressEscape()).toBe(true)
    await expect.poll(() => hook.current.turn.phase).toBe('idle')
    expect(made[0]?.abort).toHaveBeenCalledOnce()
    expect(pressEscape()).toBe(false)
  })

  it('stops listening when the Ask panel is no longer active', async () => {
    const made = stubRecognition()
    const hook = mountHook(useAskVoice, options())
    hook.current.press()
    await expect.poll(() => hook.current.turn.phase).toBe('listening')
    hook.rerender(options({ active: false }))
    await expect.poll(() => hook.current.turn.phase).toBe('idle')
    expect(made[0]?.abort).toHaveBeenCalledOnce()
  })

  it("starts over for a new book, in that book's language", async () => {
    const made = stubRecognition()
    const hook = mountHook(useAskVoice, options())
    hook.current.press()
    await expect.poll(() => hook.current.turn.phase).toBe('listening')
    await expect.poll(() => hook.current.mode).toBe('local')
    hook.rerender(options({ lang: 'de' }))
    await expect.poll(() => hook.current.turn.phase).toBe('idle')
    expect(made[0]?.abort).toHaveBeenCalledOnce()
    expect(hook.current.mode).toBe(null)
    expect(hook.current.language).toBe('German')
    hook.current.press()
    await expect.poll(() => made[1]?.lang).toBe('de')
  })

  it('stops listening, and stops taking Escape, when it unmounts', async () => {
    const made = stubRecognition()
    const hook = mountHook(useAskVoice, options())
    hook.current.press()
    await expect.poll(() => hook.current.turn.phase).toBe('listening')
    hook.unmount()
    expect(made[0]?.abort).toHaveBeenCalledOnce()
    expect(pressEscape()).toBe(false)
  })
})
