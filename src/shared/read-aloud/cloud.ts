import type { PagePosition } from '../content/position.ts'

export const VOICE_ID = /^[A-Za-z0-9]{1,64}$/

export type SpeechFormat = 'low' | 'standard'

interface SpeakCommon {
  book: string
  chapter: number
  voice: string
  format?: SpeechFormat
}

export interface SpeakSpan extends SpeakCommon {
  position: PagePosition
  start: number
  end: number
}

export interface SpeakIntro extends SpeakCommon {
  intro: true
}

export type SpeakRequest = SpeakSpan | SpeakIntro

export interface SpokenWord {
  start: number
  end: number
  t0: number
  t1: number
}

export type SpeakErrorCode =
  | 'invalid'
  | 'not_found'
  | 'signed_out'
  | 'pro'
  | 'no_key'
  | 'key_rejected'
  | 'no_credits'
  | 'permission'
  | 'voice_gone'
  | 'busy'
  | 'rate'
  | 'failed'

export interface CloudVoice {
  id: string
  name: string
  accent: string | null
  gender: string | null
  languages: string[]
}

export type SpeechVoicesState =
  | { state: 'signed_out' | 'pro' | 'no_key' | 'not_found' | 'permission' | 'key_rejected' | 'unavailable' }
  | { state: 'ready'; voices: CloudVoice[]; model: string }

export const primarySubtag = (tag: string) => tag.replace(/_/g, '-').split('-')[0]?.toLowerCase() ?? ''

export function rankCloudVoices(voices: readonly CloudVoice[], lang: string): CloudVoice[] {
  const base = primarySubtag(lang)
  const verified = (v: CloudVoice) => (v.languages.includes(base) ? 0 : 1)
  return [...voices].sort((a, b) => verified(a) - verified(b) || a.name.localeCompare(b.name, 'en'))
}
