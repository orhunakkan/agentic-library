import { describe, expect, it } from 'vitest'
import {
  type Effect,
  IDLE,
  type Phase,
  statusOf,
  step,
  type VoiceEvent,
  type VoiceTurn,
} from '~/client/features/ask-voice/voice-turn'

function run(from: VoiceTurn, ...events: VoiceEvent[]): { turn: VoiceTurn; effects: Effect[] } {
  let turn = from
  const effects: Effect[] = []
  for (const event of events) {
    const next = step(turn, event)
    turn = next.turn
    effects.push(...next.effects)
  }
  return { turn, effects }
}

const press = (mode: 'local' | 'downloadable' | 'online' | 'none' = 'local', consented = false): VoiceEvent => ({
  type: 'press',
  mode,
  consented,
})
const types = (effects: Effect[]) => effects.map((e) => e.type)

const listening = run(IDLE, press('local')).turn
const sending = run(listening, { type: 'final', text: 'Who is Mr Darcy?' }).turn
const speaking = run(sending, { type: 'answer-text', utterances: ['One.'], speak: true }).turn
const listened = run(IDLE, { type: 'listen-answer', index: 3, utterances: ['One.'] }).turn

const EVERY: Record<Phase, VoiceTurn> = {
  idle: IDLE,
  offer: run(IDLE, press('downloadable')).turn,
  downloading: run(IDLE, press('downloadable'), { type: 'download' }).turn,
  consent: run(IDLE, press('online')).turn,
  listening,
  sending,
  speaking,
  error: run(IDLE, press('none')).turn,
}

describe('the first press', () => {
  it('listens at once on the device, holding the book first', () => {
    const { turn, effects } = run(IDLE, press('local'))
    expect(turn.phase).toBe('listening')
    expect(effects).toEqual([{ type: 'hush' }, { type: 'listen', local: true }])
  })

  it('offers the download; Download installs, then listens on the device with the ready note', () => {
    const offered = run(IDLE, press('downloadable'))
    expect(offered.turn.phase).toBe('offer')
    expect(offered.effects).toEqual([])
    const downloading = run(offered.turn, { type: 'download' })
    expect(downloading.turn.phase).toBe('downloading')
    expect(downloading.effects).toEqual([{ type: 'install' }])
    expect(run(downloading.turn, press('downloadable')).turn.phase).toBe('downloading')
    const done = run(downloading.turn, { type: 'installed', ok: true })
    expect(done.turn).toMatchObject({ phase: 'listening', ready: true })
    expect(done.effects).toEqual([{ type: 'hush' }, { type: 'listen', local: true }])
  })

  it('a failed download brings the offer back with the failure; Use online recognition asks first', () => {
    const failed = run(EVERY.downloading, { type: 'installed', ok: false }).turn
    expect(failed).toMatchObject({ phase: 'offer', failed: true })
    expect(run(failed, { type: 'use-online', consented: false }).turn.phase).toBe('consent')
    expect(run(failed, { type: 'use-online', consented: true }).effects).toEqual([
      { type: 'hush' },
      { type: 'listen', local: false },
    ])
  })

  it('Not now and Cancel put the offer and the download away; a late install is ignored', () => {
    expect(run(EVERY.offer, { type: 'not-now' }).turn).toEqual(IDLE)
    const cancelled = run(EVERY.downloading, { type: 'cancel' }).turn
    expect(cancelled).toEqual(IDLE)
    expect(run(cancelled, { type: 'installed', ok: true })).toEqual({ turn: IDLE, effects: [] })
  })

  it('online asks for consent once: Use voice remembers it and listens, Cancel does nothing', () => {
    expect(EVERY.consent.phase).toBe('consent')
    expect(run(EVERY.consent, { type: 'consent' }).effects).toEqual([
      { type: 'consented' },
      { type: 'hush' },
      { type: 'listen', local: false },
    ])
    expect(run(EVERY.consent, { type: 'decline' }).turn).toEqual(IDLE)
    expect(run(IDLE, press('online', true)).effects).toEqual([{ type: 'hush' }, { type: 'listen', local: false }])
  })

  it('says the browser can’t recognise the language when nothing can', () => {
    expect(EVERY.error).toMatchObject({ phase: 'error', error: 'unsupported' })
  })

  it('the next press clears a notice and the ready note', () => {
    expect(run(EVERY.error, press('local')).turn).toMatchObject({ phase: 'listening', error: null })
    const ready = run(EVERY.downloading, { type: 'installed', ok: true }, { type: 'final', text: 'Hi' }).turn
    expect(ready.ready).toBe(true)
    expect(run(ready, { type: 'answer-end', outcome: 'done', utterances: [], speak: true }, press()).turn.ready).toBe(
      false,
    )
  })
})

describe('listening', () => {
  it('shows what is heard, then sends the question when it ends', () => {
    const heard = run(listening, { type: 'interim', text: 'Who  is' }, { type: 'interim', text: 'Who is Mr Darcy' })
    expect(heard.turn.heard).toBe('Who is Mr Darcy')
    const sent = run(heard.turn, { type: 'final', text: '  Who is   Mr Darcy? ' })
    expect(sent.turn.phase).toBe('sending')
    expect(sent.effects).toEqual([{ type: 'send', text: 'Who is Mr Darcy?' }])
  })

  it('a second press is Stop and send: it stops once, then the final result sends', () => {
    const stopping = run(listening, press())
    expect(stopping.turn.stopping).toBe(true)
    expect(stopping.effects).toEqual([{ type: 'stop-listening' }])
    expect(run(stopping.turn, press()).effects).toEqual([])
    expect(run(stopping.turn, { type: 'final', text: 'So far' }).effects).toEqual([{ type: 'send', text: 'So far' }])
  })

  it('Esc or Cancel aborts and sends nothing', () => {
    const { turn, effects } = run(listening, { type: 'interim', text: 'Never' }, { type: 'cancel' })
    expect(turn).toEqual(IDLE)
    expect(effects).toEqual([{ type: 'abort-listening' }])
  })

  it('nothing heard, or too much, sends nothing and says why', () => {
    expect(run(listening, { type: 'final', text: '   ' })).toEqual({
      turn: { ...IDLE, phase: 'error', error: 'empty' },
      effects: [],
    })
    expect(run(listening, { type: 'final', text: 'a'.repeat(2_001) }).turn.error).toBe('too-long')
    expect(run(listening, { type: 'final', text: 'a'.repeat(2_000) }).turn.phase).toBe('sending')
  })

  it('passes on recognition errors, and the browser’s own abort shows nothing', () => {
    expect(run(listening, { type: 'recognition-error', code: 'not-allowed' }).turn.error).toBe('not-allowed')
    expect(run(listening, { type: 'recognition-error', code: 'phrases-not-supported' }).turn.error).toBe('failed')
    expect(run(listening, { type: 'recognition-error', code: 'aborted' }).turn).toEqual(IDLE)
  })

  it('a typed send while listening aborts it', () => {
    expect(run(listening, { type: 'typed-send' })).toEqual({ turn: IDLE, effects: [{ type: 'abort-listening' }] })
    expect(run(IDLE, { type: 'typed-send' })).toEqual({ turn: IDLE, effects: [] })
    expect(run(EVERY.offer, { type: 'typed-send' }).turn).toEqual(IDLE)
  })

  it('a typed send while the spoken question’s answer is on its way leaves it to be said', () => {
    expect(run(sending, { type: 'typed-send' })).toEqual({ turn: sending, effects: [] })
  })

  it('ignores recognition events outside listening', () => {
    for (const event of [
      { type: 'interim', text: 'x' },
      { type: 'final', text: 'x' },
      { type: 'recognition-error', code: 'network' },
    ] as VoiceEvent[]) {
      expect(run(IDLE, event)).toEqual({ turn: IDLE, effects: [] })
    }
  })
})

describe('hearing the answer', () => {
  it('speaks sentences as they complete while it streams, then finishes when all is said', () => {
    expect(run(sending, { type: 'answer-text', utterances: [], speak: true }).turn.phase).toBe('sending')
    const first = run(sending, { type: 'answer-text', utterances: ['One.'], speak: true })
    expect(first.turn).toMatchObject({ phase: 'speaking', streaming: true })
    expect(first.effects).toEqual([{ type: 'say', utterances: ['One.'] }])
    const more = run(first.turn, { type: 'answer-text', utterances: ['Two.'], speak: true })
    expect(more.effects).toEqual([{ type: 'append', utterances: ['Two.'] }])
    expect(run(more.turn, { type: 'answer-text', utterances: [], speak: true }).effects).toEqual([])
    const waiting = run(more.turn, { type: 'speech-idle' }).turn
    expect(waiting).toMatchObject({ phase: 'speaking', drained: true })
    const ended = run(waiting, { type: 'answer-end', outcome: 'done', utterances: ['Three.'], speak: true })
    expect(ended.effects).toEqual([{ type: 'append', utterances: ['Three.'] }])
    expect(ended.turn).toMatchObject({ phase: 'speaking', streaming: false, drained: false })
    expect(run(ended.turn, { type: 'speech-idle' }).turn).toEqual(IDLE)
  })

  it('more text after everything so far was said is still to be said when the answer ends', () => {
    const drained = run(speaking, { type: 'speech-idle' }).turn
    const more = run(drained, { type: 'answer-text', utterances: ['Two.'], speak: true })
    expect(more.effects).toEqual([{ type: 'append', utterances: ['Two.'] }])
    const ended = run(more.turn, { type: 'answer-end', outcome: 'done', utterances: [], speak: true }).turn
    expect(ended).toMatchObject({ phase: 'speaking', streaming: false })
    expect(run(ended, { type: 'speech-idle' }).turn).toEqual(IDLE)
  })

  it('an answer done with nothing left to say, once all was said, is idle', () => {
    const drained = run(speaking, { type: 'speech-idle' }).turn
    expect(run(drained, { type: 'answer-end', outcome: 'done', utterances: [], speak: true }).turn).toEqual(IDLE)
    const still = run(speaking, { type: 'answer-end', outcome: 'done', utterances: [], speak: true }).turn
    expect(still).toMatchObject({ phase: 'speaking', streaming: false })
    expect(run(still, { type: 'speech-idle' }).turn).toEqual(IDLE)
  })

  it('a short answer all in its end is said whole; an answer with nothing to say is idle', () => {
    const whole = run(sending, { type: 'answer-end', outcome: 'done', utterances: ['All.'], speak: true })
    expect(whole.turn).toMatchObject({ phase: 'speaking', streaming: false })
    expect(whole.effects).toEqual([{ type: 'say', utterances: ['All.'] }])
    expect(run(sending, { type: 'answer-end', outcome: 'done', utterances: [], speak: true }).turn).toEqual(IDLE)
  })

  it('with Read answers aloud off, nothing is said', () => {
    expect(run(sending, { type: 'answer-text', utterances: ['One.'], speak: false })).toEqual({
      turn: IDLE,
      effects: [],
    })
    expect(run(sending, { type: 'answer-end', outcome: 'done', utterances: ['One.'], speak: false }).turn).toEqual(IDLE)
  })

  it('a stream that fails partway says what was complete, then is idle', () => {
    const failed = run(speaking, { type: 'answer-end', outcome: 'failed', utterances: [], speak: true })
    expect(failed.effects).toEqual([])
    expect(failed.turn).toMatchObject({ phase: 'speaking', streaming: false })
    expect(run(failed.turn, { type: 'speech-idle' }).turn).toEqual(IDLE)
    expect(run(sending, { type: 'answer-end', outcome: 'failed', utterances: [], speak: true }).turn).toEqual(IDLE)
  })

  it('the panel’s Stop stops the stream and the speaking', () => {
    expect(run(speaking, { type: 'answer-end', outcome: 'stopped', utterances: [], speak: true })).toEqual({
      turn: IDLE,
      effects: [{ type: 'stop-speaking' }],
    })
    expect(run(sending, { type: 'answer-end', outcome: 'stopped', utterances: [], speak: true }).turn).toEqual(IDLE)
  })

  it('Stop speaking stops only the speech', () => {
    expect(run(speaking, { type: 'stop-speaking' })).toEqual({ turn: IDLE, effects: [{ type: 'stop-speaking' }] })
    expect(run(IDLE, { type: 'stop-speaking' })).toEqual({ turn: IDLE, effects: [] })
  })

  it('a voice that fails three times says so; the book taking the speaker back ends it', () => {
    expect(run(speaking, { type: 'speech-failed' }).turn).toMatchObject({ phase: 'error', error: 'voice-failed' })
    expect(run(speaking, { type: 'speech-interrupted' }).turn).toEqual(IDLE)
    expect(run(IDLE, { type: 'speech-failed' }).turn).toEqual(IDLE)
    expect(run(IDLE, { type: 'speech-interrupted' }).turn).toEqual(IDLE)
    expect(run(IDLE, { type: 'speech-idle' }).turn).toEqual(IDLE)
  })

  it('ignores answer events that aren’t a spoken question’s', () => {
    expect(run(IDLE, { type: 'answer-text', utterances: ['x'], speak: true }).turn).toEqual(IDLE)
    expect(run(listened, { type: 'answer-text', utterances: ['x'], speak: true }).effects).toEqual([])
    expect(run(listened, { type: 'answer-end', outcome: 'done', utterances: ['x'], speak: true }).effects).toEqual([])
  })
})

describe('barge-in', () => {
  it('pressing the microphone while an answer is said stops the answer and the speech, and listens', () => {
    const { turn, effects } = run(speaking, press())
    expect(turn.phase).toBe('listening')
    expect(effects).toEqual([
      { type: 'stop-answer' },
      { type: 'stop-speaking' },
      { type: 'hush' },
      { type: 'listen', local: true },
    ])
  })

  it('while the answer streams before any speech, it stops the answer', () => {
    expect(types(run(sending, press()).effects)).toEqual(['stop-answer', 'hush', 'listen'])
  })

  it('while a finished answer is said, it stops only the speech', () => {
    expect(types(run(listened, press()).effects)).toEqual(['stop-speaking', 'hush', 'listen'])
  })
})

describe('Listen', () => {
  it('reads a finished answer from the start, holding the book, and Stop ends it', () => {
    const { turn, effects } = run(IDLE, { type: 'listen-answer', index: 3, utterances: ['One.', 'Two.'] })
    expect(turn).toMatchObject({ phase: 'speaking', listen: 3, streaming: false })
    expect(effects).toEqual([{ type: 'hush' }, { type: 'say', utterances: ['One.', 'Two.'] }])
    expect(run(turn, { type: 'speech-idle' }).turn).toEqual(IDLE)
  })

  it('while listening, it aborts listening first; with nothing to say it says nothing', () => {
    expect(types(run(listening, { type: 'listen-answer', index: 0, utterances: ['A.'] }).effects)).toEqual([
      'abort-listening',
      'hush',
      'say',
    ])
    expect(run(listening, { type: 'listen-answer', index: 0, utterances: [] })).toEqual({
      turn: IDLE,
      effects: [{ type: 'abort-listening' }],
    })
    expect(run(IDLE, { type: 'listen-answer', index: 0, utterances: [] })).toEqual({ turn: IDLE, effects: [] })
  })

  it('another answer’s Listen replaces the one playing', () => {
    expect(run(listened, { type: 'listen-answer', index: 5, utterances: ['B.'] }).turn.listen).toBe(5)
  })
})

describe('Clear, closing or leaving', () => {
  it.each(Object.entries(EVERY))('from %s resets, undoing what it must', (phase, turn) => {
    const { turn: next, effects } = run(turn, { type: 'reset' })
    expect(next).toEqual(IDLE)
    const undo = phase === 'listening' ? ['abort-listening'] : phase === 'speaking' ? ['stop-speaking'] : []
    expect(types(effects)).toEqual(undo)
  })

  it('cancel does nothing while sending or speaking', () => {
    expect(run(sending, { type: 'cancel' }).turn).toBe(sending)
    expect(run(speaking, { type: 'cancel' }).turn).toBe(speaking)
    expect(run(EVERY.error, { type: 'cancel' }).turn).toEqual(IDLE)
  })

  it('events for other phases change nothing', () => {
    for (const event of [
      { type: 'download' },
      { type: 'use-online', consented: true },
      { type: 'not-now' },
      { type: 'consent' },
      { type: 'decline' },
    ] as VoiceEvent[]) {
      expect(run(IDLE, event)).toEqual({ turn: IDLE, effects: [] })
    }
  })
})

describe('statusOf', () => {
  it('says listening, sending or reading the answer', () => {
    expect(statusOf(listening)).toBe('listening')
    expect(statusOf(sending)).toBe('sending')
    expect(statusOf(speaking)).toBe('speaking')
    expect(statusOf(IDLE)).toBeNull()
    expect(statusOf(EVERY.offer)).toBeNull()
  })
})
