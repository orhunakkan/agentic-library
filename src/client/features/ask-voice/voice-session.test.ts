import { describe, expect, it, vi } from 'vitest'
import type { Aside, AsideHandlers } from '~/client/features/read-aloud/aside'
import { citationMarker as cite } from '../ask/answer-format'
import type { ListenHandlers, Mode, Recognition } from './recognition'
import { ELEVENLABS_SEEN_KEY, ONLINE_KEY, SPEAK_KEY } from './voice-prefs'
import { createVoiceSession, type VoiceState } from './voice-session'

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

function fakeRecognition(options: { mode?: Mode; online?: boolean; install?: Promise<boolean> } = {}) {
  const listens: {
    lang: string
    local: boolean
    handlers: ListenHandlers
    stop: ReturnType<typeof vi.fn>
    abort: ReturnType<typeof vi.fn>
  }[] = []
  const recognition: Recognition = {
    mode: vi.fn(async () => options.mode ?? 'local'),
    online: vi.fn(async () => options.online ?? true),
    install: vi.fn(() => options.install ?? Promise.resolve(true)),
    listen: (lang, { local, ...handlers }) => {
      const entry = { lang, local, handlers, stop: vi.fn(), abort: vi.fn() }
      listens.push(entry)
      return { stop: entry.stop, abort: entry.abort }
    },
  }
  return { recognition, listens, last: () => listens.at(-1) }
}

function fakeAside(options: { skippedCloud?: boolean } = {}) {
  const said: string[][] = []
  let handlers: AsideHandlers | null = null
  const aside: Aside = {
    voiceFor: vi.fn(async () => ({ voice: null, skippedCloud: options.skippedCloud ?? false })),
    hush: vi.fn(),
    say: vi.fn((utterances, _book, h) => {
      said.push([...utterances])
      handlers = h
    }),
    append: vi.fn((utterances) => said.at(-1)?.push(...utterances)),
    stop: vi.fn(),
    interrupt: vi.fn(),
    active: () => handlers !== null,
  }
  return {
    aside,
    said,
    idle: () => handlers?.onIdle(),
    failed: () => handlers?.onFailed(),
    interrupted: () => handlers?.onInterrupted(),
  }
}

function setup(options: Parameters<typeof fakeRecognition>[0] & { skippedCloud?: boolean; none?: boolean } = {}) {
  const rec = fakeRecognition(options)
  const speech = fakeAside(options)
  const storage = memoryStorage()
  const states: VoiceState[] = []
  const send = vi.fn()
  const stopAnswer = vi.fn()
  let busy = false
  const session = createVoiceSession({
    recognition: options.none ? null : rec.recognition,
    aside: () => speech.aside,
    storage,
    send,
    stopAnswer,
    busy: () => busy,
    onState: (s) => states.push(s),
  })
  session.setBook('en-GB', false)
  return {
    session,
    rec,
    speech,
    storage,
    send,
    stopAnswer,
    setBusy: (b: boolean) => {
      busy = b
    },
    phase: () => session.state().turn.phase,
  }
}

const ANSWER = `It is his rank${cite(0)}. He says so. And more`

describe('asking by voice', () => {
  it('listens on the device after the first press, shows what is heard, and sends it', async () => {
    const t = setup()
    t.session.press()
    expect(t.speech.aside.hush).toHaveBeenCalled()
    await flush()
    expect(t.rec.recognition.mode).toHaveBeenCalledWith('en-GB')
    expect(t.phase()).toBe('listening')
    expect(t.rec.last()).toMatchObject({ lang: 'en-GB', local: true })
    t.rec.last()?.handlers.onInterim('Who is')
    expect(t.session.state().turn.heard).toBe('Who is')
    t.rec.last()?.handlers.onFinal('Who is Mr Darcy?')
    expect(t.send).toHaveBeenCalledWith('Who is Mr Darcy?')
    expect(t.phase()).toBe('sending')
  })

  it('a second press is Stop and send; Cancel aborts', async () => {
    const t = setup({ mode: 'local' })
    t.session.probe()
    await flush()
    t.session.press()
    expect(t.phase()).toBe('listening')
    t.session.press()
    expect(t.rec.last()?.stop).toHaveBeenCalled()
    t.session.dispatch({ type: 'cancel' })
    expect(t.rec.last()?.abort).toHaveBeenCalled()
    expect(t.phase()).toBe('idle')
  })

  it('passes on a recognition error', async () => {
    const t = setup()
    t.session.press()
    await flush()
    t.rec.last()?.handlers.onError('not-allowed')
    expect(t.session.state().turn).toMatchObject({ phase: 'error', error: 'not-allowed' })
  })

  it('downloads the language inside the press, then listens with the mode now local', async () => {
    let finish: (ok: boolean) => void = () => {}
    const t = setup({ mode: 'downloadable', install: new Promise((r) => (finish = r)) })
    t.session.press()
    await flush()
    expect(t.phase()).toBe('offer')
    t.session.dispatch({ type: 'download' })
    expect(t.rec.recognition.install).toHaveBeenCalledWith('en-GB')
    expect(t.phase()).toBe('downloading')
    finish(true)
    await flush()
    expect(t.session.state()).toMatchObject({ mode: 'local', turn: { phase: 'listening', ready: true } })
  })

  it('a download that ends after the book changed is ignored', async () => {
    let finish: (ok: boolean) => void = () => {}
    const t = setup({ mode: 'downloadable', install: new Promise((r) => (finish = r)) })
    t.session.press()
    await flush()
    t.session.dispatch({ type: 'download' })
    t.session.setBook('fr', false)
    finish(true)
    await flush()
    expect(t.session.state()).toMatchObject({ mode: null, turn: { phase: 'idle' } })
  })

  it('remembers online consent, and the menu’s switch withdraws it', async () => {
    const t = setup({ mode: 'online' })
    t.session.press()
    await flush()
    expect(t.phase()).toBe('consent')
    t.session.dispatch({ type: 'consent' })
    expect(t.storage.getItem(ONLINE_KEY)).toBe('yes')
    expect(t.session.state().consented).toBe(true)
    expect(t.rec.last()?.local).toBe(false)
    t.session.setConsented(false)
    expect(t.storage.getItem(ONLINE_KEY)).toBeNull()
    expect(t.session.state().consented).toBe(false)
  })

  it('asks the browser once per language, only when reached for', async () => {
    const t = setup({ online: false })
    expect(t.rec.recognition.mode).not.toHaveBeenCalled()
    t.session.probe()
    t.session.probe()
    await flush()
    expect(t.rec.recognition.mode).toHaveBeenCalledTimes(1)
    expect(t.session.state()).toMatchObject({ mode: 'local', online: false })
    t.session.setBook('en-GB', false)
    t.session.setBook('fr', true)
    expect(t.session.state().mode).toBeNull()
    t.session.probe()
    await flush()
    expect(t.rec.recognition.mode).toHaveBeenLastCalledWith('fr')
  })

  it('without recognition there is no microphone to press, but Listen still reads', () => {
    const t = setup({ none: true })
    t.session.press()
    t.session.probe()
    t.session.dispatch({ type: 'download' })
    expect(t.phase()).toBe('idle')
    t.session.listen(2, 'One. Two.')
    expect(t.speech.said).toEqual([['One.', 'Two.']])
  })

  it('asks for online consent once on this device: a later turn listens at once', async () => {
    const t = setup({ mode: 'online' })
    t.session.press()
    await flush()
    t.session.consent()
    t.session.cancel()
    t.session.press()
    expect(t.phase()).toBe('listening')
    expect(t.rec.listens.map((l) => l.local)).toEqual([false, false])
  })

  it('the same book again changes nothing, so a turn in progress goes on', async () => {
    const t = setup()
    t.session.press()
    await flush()
    t.session.setBook('en-GB', false)
    expect(t.phase()).toBe('listening')
    expect(t.rec.last()?.abort).not.toHaveBeenCalled()
    expect(t.session.state().mode).toBe('local')
  })

  it('a send while the last answer is still stopping ends the turn instead of hanging', async () => {
    const t = setup()
    t.session.press()
    await flush()
    t.setBusy(true)
    t.rec.last()?.handlers.onFinal('Again?')
    expect(t.send).not.toHaveBeenCalled()
    expect(t.phase()).toBe('idle')
  })
})

describe('hearing the answer', () => {
  const asked = async () => {
    const t = setup()
    t.session.press()
    await flush()
    t.rec.last()?.handlers.onFinal('Why?')
    return t
  }

  it('says complete sentences as the answer streams, then the rest once done', async () => {
    const t = await asked()
    t.session.answer('', 'done', null)
    expect(t.speech.said).toEqual([])
    t.session.answer(ANSWER, 'done', null)
    expect(t.speech.said).toEqual([['It is his rank.', 'He says so.']])
    expect(t.phase()).toBe('speaking')
    t.speech.idle()
    t.session.answer(null, 'done', ANSWER)
    expect(t.speech.said).toEqual([['It is his rank.', 'He says so.', 'And more']])
    t.speech.idle()
    expect(t.phase()).toBe('idle')
  })

  it('ignores answers it didn’t ask for, and an end before the answer showed up', async () => {
    const t = setup()
    t.session.answer('Typed question’s answer. More.', 'done', null)
    t.session.answer(null, 'done', 'Typed question’s answer. More.')
    expect(t.speech.said).toEqual([])
  })

  it('an answer that arrives and ends within one render is still said, whole', async () => {
    const t = await asked()
    t.session.answer(null, 'done', ANSWER)
    expect(t.speech.said).toEqual([['It is his rank.', 'He says so.', 'And more']])
    expect(t.phase()).toBe('speaking')
  })

  it('the end says what streamed past the last render, from the stored answer', async () => {
    const t = await asked()
    t.session.answer('It is his rank', 'done', null)
    expect(t.speech.said).toEqual([])
    t.session.answer(null, 'done', ANSWER)
    expect(t.speech.said).toEqual([['It is his rank.', 'He says so.', 'And more']])
  })

  it('the panel’s Stop stops the speaking too; a failed stream says only what was complete', async () => {
    const t = await asked()
    t.session.answer(ANSWER, 'done', null)
    t.session.answer(null, 'stopped', ANSWER)
    expect(t.speech.aside.stop).toHaveBeenCalled()
    expect(t.phase()).toBe('idle')

    const u = await asked()
    u.session.answer(ANSWER, 'done', null)
    u.session.answer(null, 'failed', null)
    expect(u.speech.said).toEqual([['It is his rank.', 'He says so.']])
    u.speech.idle()
    expect(u.phase()).toBe('idle')
  })

  it('a stream that fails says nothing of the answer before it', async () => {
    const t = await asked()
    t.session.answer('It is his rank. He says so. And mo', 'done', null)
    t.session.answer(null, 'failed', 'An earlier answer. About something. Else entirely. And more.')
    expect(t.speech.said).toEqual([['It is his rank.', 'He says so.']])
  })

  it('keeps Read answers aloud off on this device, for the next page', () => {
    const storage = memoryStorage()
    storage.setItem(SPEAK_KEY, 'off')
    const session = createVoiceSession({
      recognition: null,
      aside: () => fakeAside().aside,
      storage,
      send: () => {},
      stopAnswer: () => {},
      busy: () => false,
      onState: () => {},
    })
    expect(session.state().speak).toBe(false)
  })

  it('with Read answers aloud off, nothing is said, and the setting is kept', async () => {
    const t = setup()
    t.session.setSpeak(false)
    expect(t.storage.getItem(SPEAK_KEY)).toBe('off')
    t.session.press()
    await flush()
    t.rec.last()?.handlers.onFinal('Why?')
    t.session.answer(ANSWER, 'done', null)
    t.session.answer(null, 'done', ANSWER)
    expect(t.speech.said).toEqual([])
    expect(t.phase()).toBe('idle')
    t.session.setSpeak(true)
    expect(t.session.state().speak).toBe(true)
  })

  it('barge-in stops the answer and the speech, and listens again', async () => {
    const t = await asked()
    t.session.answer(ANSWER, 'done', null)
    t.session.press()
    await flush()
    expect(t.stopAnswer).toHaveBeenCalled()
    expect(t.speech.aside.stop).toHaveBeenCalled()
    expect(t.phase()).toBe('listening')
  })

  it('a voice that fails, or the book taking the speaker back, ends the speaking', async () => {
    const t = await asked()
    t.session.answer(ANSWER, 'done', null)
    t.speech.failed()
    expect(t.session.state().turn.error).toBe('voice-failed')
    const u = await asked()
    u.session.answer(ANSWER, 'done', null)
    u.speech.interrupted()
    expect(u.phase()).toBe('idle')
  })

  it('says once per device that ElevenLabs reads only the book, until the next press', async () => {
    const t = setup({ skippedCloud: true })
    t.session.listen(0, 'One.')
    await flush()
    expect(t.session.state().elevenLabsNote).toBe(true)
    expect(t.storage.getItem(ELEVENLABS_SEEN_KEY)).toBe('yes')
    t.session.press()
    expect(t.session.state().elevenLabsNote).toBe(false)
    t.session.reset()
    t.session.listen(0, 'One.')
    await flush()
    expect(t.session.state().elevenLabsNote).toBe(false)
    expect(t.speech.aside.voiceFor).toHaveBeenCalledTimes(1)
  })

  it('says nothing about ElevenLabs when no ElevenLabs voice was passed over', async () => {
    const t = setup({ skippedCloud: false })
    t.session.listen(0, 'One.')
    await flush()
    expect(t.session.state().elevenLabsNote).toBe(false)
    expect(t.storage.getItem(ELEVENLABS_SEEN_KEY)).toBeNull()
  })

  it('reset hides the note and stops what is going on', async () => {
    const t = setup({ skippedCloud: true })
    t.session.listen(0, 'One.')
    await flush()
    t.session.reset()
    expect(t.session.state().elevenLabsNote).toBe(false)
    expect(t.speech.aside.stop).toHaveBeenCalled()
    expect(t.phase()).toBe('idle')
  })
})

describe('the notices’ buttons', () => {
  it('Download, Use online recognition, Not now, Use voice and Cancel move the turn', async () => {
    const t = setup({ mode: 'downloadable' })
    t.session.press()
    await flush()
    t.session.notNow()
    expect(t.phase()).toBe('idle')
    t.session.press()
    await flush()
    t.session.useOnline()
    expect(t.phase()).toBe('consent')
    t.session.decline()
    expect(t.phase()).toBe('idle')
    t.session.press()
    await flush()
    t.session.useOnline()
    t.session.consent()
    expect(t.phase()).toBe('listening')
    t.session.typedSend()
    expect(t.phase()).toBe('idle')
    t.session.press()
    await flush()
    t.session.download()
    expect(t.phase()).toBe('downloading')
    t.session.cancel()
    expect(t.phase()).toBe('idle')
  })

  it('Stop speaking ends the speech', () => {
    const t = setup()
    t.session.listen(0, 'One.')
    t.session.stopSpeaking()
    expect(t.phase()).toBe('idle')
    expect(t.speech.aside.stop).toHaveBeenCalled()
  })
})

describe('Listen', () => {
  it('reads a finished answer, holding the book, and pressing it again stops it', () => {
    const t = setup()
    t.session.listen(3, `It is his rank${cite(0)}. He says so.`)
    expect(t.speech.aside.hush).toHaveBeenCalled()
    expect(t.speech.said).toEqual([['It is his rank.', 'He says so.']])
    expect(t.session.state().turn).toMatchObject({ phase: 'speaking', listen: 3 })
    t.session.listen(3, 'ignored')
    expect(t.phase()).toBe('idle')
    expect(t.speech.aside.stop).toHaveBeenCalled()
  })

  it('another answer’s Listen reads that one instead', () => {
    const t = setup()
    t.session.listen(3, 'One.')
    t.session.listen(5, 'Five.')
    expect(t.session.state().turn).toMatchObject({ phase: 'speaking', listen: 5 })
    expect(t.speech.said).toEqual([['One.'], ['Five.']])
  })
})
