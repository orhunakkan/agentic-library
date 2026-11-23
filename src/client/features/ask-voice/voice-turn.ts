import { QUESTION_MAX } from '~/client/features/ask/ask-client'
import type { Mode } from './recognition'
import { type VoiceErrorCode, voiceErrorCode } from './voice-messages'

export type Phase = 'idle' | 'offer' | 'downloading' | 'consent' | 'listening' | 'sending' | 'speaking' | 'error'

export interface VoiceTurn {
  phase: Phase
  heard: string
  stopping: boolean
  failed: boolean
  ready: boolean
  error: VoiceErrorCode | null
  streaming: boolean
  drained: boolean
  listen: number | null
}

export type Effect =
  | { type: 'hush' }
  | { type: 'listen'; local: boolean }
  | { type: 'stop-listening' }
  | { type: 'abort-listening' }
  | { type: 'install' }
  | { type: 'consented' }
  | { type: 'send'; text: string }
  | { type: 'say'; utterances: string[] }
  | { type: 'append'; utterances: string[] }
  | { type: 'stop-speaking' }
  | { type: 'stop-answer' }

export type VoiceEvent =
  | { type: 'press'; mode: Mode; consented: boolean }
  | { type: 'download' }
  | { type: 'use-online'; consented: boolean }
  | { type: 'not-now' }
  | { type: 'installed'; ok: boolean }
  | { type: 'consent' }
  | { type: 'decline' }
  | { type: 'interim'; text: string }
  | { type: 'final'; text: string }
  | { type: 'recognition-error'; code: string }
  | { type: 'cancel' }
  | { type: 'answer-text'; utterances: string[]; speak: boolean }
  | { type: 'answer-end'; outcome: 'done' | 'failed' | 'stopped'; utterances: string[]; speak: boolean }
  | { type: 'speech-idle' }
  | { type: 'speech-failed' }
  | { type: 'speech-interrupted' }
  | { type: 'listen-answer'; index: number; utterances: string[] }
  | { type: 'stop-speaking' }
  | { type: 'typed-send' }
  | { type: 'reset' }

export const IDLE: VoiceTurn = {
  phase: 'idle',
  heard: '',
  stopping: false,
  failed: false,
  ready: false,
  error: null,
  streaming: false,
  drained: false,
  listen: null,
}

export interface Step {
  turn: VoiceTurn
  effects: Effect[]
}

const at = (phase: Phase, patch: Partial<VoiceTurn> = {}): VoiceTurn => ({ ...IDLE, phase, ...patch })
const same = (turn: VoiceTurn): Step => ({ turn, effects: [] })

function leave(turn: VoiceTurn): Effect[] {
  if (turn.phase === 'listening') return [{ type: 'abort-listening' }]
  if (turn.phase === 'speaking') return [{ type: 'stop-speaking' }]
  return []
}

const listening = (local: boolean, before: Effect[] = [], patch: Partial<VoiceTurn> = {}): Step => ({
  turn: at('listening', patch),
  effects: [...before, { type: 'hush' }, { type: 'listen', local }],
})

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim()

const answering = (turn: VoiceTurn) => turn.phase === 'sending' || (turn.phase === 'speaking' && turn.streaming)

export function step(turn: VoiceTurn, event: VoiceEvent): Step {
  switch (event.type) {
    case 'press': {
      if (turn.phase === 'downloading') return same(turn)
      if (turn.phase === 'listening') {
        return turn.stopping ? same(turn) : { turn: { ...turn, stopping: true }, effects: [{ type: 'stop-listening' }] }
      }
      const before: Effect[] = [
        ...(answering(turn) ? [{ type: 'stop-answer' } as const] : []),
        ...(turn.phase === 'speaking' ? [{ type: 'stop-speaking' } as const] : []),
      ]
      if (event.mode === 'local') return listening(true, before)
      if (event.mode === 'downloadable') return { turn: at('offer'), effects: before }
      if (event.mode === 'online')
        return event.consented ? listening(false, before) : { turn: at('consent'), effects: before }
      return { turn: at('error', { error: 'unsupported' }), effects: before }
    }
    case 'download':
      return turn.phase === 'offer' ? { turn: at('downloading'), effects: [{ type: 'install' }] } : same(turn)
    case 'use-online':
      if (turn.phase !== 'offer') return same(turn)
      return event.consented ? listening(false) : { turn: at('consent'), effects: [] }
    case 'not-now':
      return turn.phase === 'offer' ? { turn: IDLE, effects: [] } : same(turn)
    case 'installed':
      if (turn.phase !== 'downloading') return same(turn)
      return event.ok ? listening(true, [], { ready: true }) : { turn: at('offer', { failed: true }), effects: [] }
    case 'consent':
      return turn.phase === 'consent' ? listening(false, [{ type: 'consented' }]) : same(turn)
    case 'decline':
      return turn.phase === 'consent' ? { turn: IDLE, effects: [] } : same(turn)
    case 'interim':
      return turn.phase === 'listening' ? same({ ...turn, heard: collapse(event.text) }) : same(turn)
    case 'final': {
      if (turn.phase !== 'listening') return same(turn)
      const text = collapse(event.text)
      if (!text) return { turn: at('error', { error: 'empty' }), effects: [] }
      if ([...text].length > QUESTION_MAX) return { turn: at('error', { error: 'too-long' }), effects: [] }
      return { turn: at('sending', { ready: turn.ready }), effects: [{ type: 'send', text }] }
    }
    case 'recognition-error':
      if (turn.phase !== 'listening') return same(turn)
      return event.code === 'aborted'
        ? { turn: IDLE, effects: [] }
        : { turn: at('error', { error: voiceErrorCode(event.code) }), effects: [] }
    case 'cancel':
      if (turn.phase === 'listening') return { turn: IDLE, effects: [{ type: 'abort-listening' }] }
      if (['offer', 'consent', 'downloading', 'error'].includes(turn.phase)) return { turn: IDLE, effects: [] }
      return same(turn)
    case 'answer-text': {
      if (turn.phase === 'sending') {
        if (!event.speak) return { turn: IDLE, effects: [] }
        if (!event.utterances.length) return same(turn)
        return {
          turn: at('speaking', { streaming: true }),
          effects: [{ type: 'say', utterances: event.utterances }],
        }
      }
      if (turn.phase === 'speaking' && turn.streaming && event.utterances.length)
        return { turn: { ...turn, drained: false }, effects: [{ type: 'append', utterances: event.utterances }] }
      return same(turn)
    }
    case 'answer-end': {
      if (turn.phase === 'sending') {
        if (event.outcome === 'done' && event.speak && event.utterances.length)
          return { turn: at('speaking'), effects: [{ type: 'say', utterances: event.utterances }] }
        return { turn: IDLE, effects: [] }
      }
      if (turn.phase !== 'speaking' || !turn.streaming) return same(turn)
      if (event.outcome === 'stopped') return { turn: IDLE, effects: [{ type: 'stop-speaking' }] }
      if (event.utterances.length)
        return {
          turn: { ...turn, streaming: false, drained: false },
          effects: [{ type: 'append', utterances: event.utterances }],
        }
      return turn.drained ? { turn: IDLE, effects: [] } : same({ ...turn, streaming: false })
    }
    case 'speech-idle':
      if (turn.phase !== 'speaking') return same(turn)
      return turn.streaming ? same({ ...turn, drained: true }) : { turn: IDLE, effects: [] }
    case 'speech-failed':
      return turn.phase === 'speaking' ? { turn: at('error', { error: 'voice-failed' }), effects: [] } : same(turn)
    case 'speech-interrupted':
      return turn.phase === 'speaking' ? { turn: IDLE, effects: [] } : same(turn)
    case 'listen-answer': {
      const before = turn.phase === 'listening' ? [{ type: 'abort-listening' } as const] : []
      if (!event.utterances.length) return { turn: turn.phase === 'listening' ? IDLE : turn, effects: before }
      return {
        turn: at('speaking', { listen: event.index }),
        effects: [...before, { type: 'hush' }, { type: 'say', utterances: event.utterances }],
      }
    }
    case 'stop-speaking':
      return turn.phase === 'speaking' ? { turn: IDLE, effects: [{ type: 'stop-speaking' }] } : same(turn)
    case 'typed-send':
      return turn.phase === 'idle' || turn.phase === 'sending' ? same(turn) : { turn: IDLE, effects: leave(turn) }
    case 'reset':
      return { turn: IDLE, effects: leave(turn) }
  }
}

export function statusOf(turn: VoiceTurn): 'listening' | 'sending' | 'speaking' | null {
  if (turn.phase === 'listening' || turn.phase === 'sending') return turn.phase
  return turn.phase === 'speaking' ? 'speaking' : null
}
