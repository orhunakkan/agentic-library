import type { TranslateLanguage } from './languages.ts'

export type WordSource = 'dictionary' | 'wikipedia'

export interface WordRequest {
  book: string
  term: string
  source: WordSource
}

export interface Definition {
  text: string
  lemma?: string
}

export interface Sense {
  partOfSpeech: string
  definitions: Definition[]
}

export interface DictionaryEntry {
  state: 'found'
  source: 'dictionary'
  term: string
  language: string
  languageName: string
  otherLanguage: boolean
  senses: Sense[]
  url: string
}

export interface WikipediaSummary {
  state: 'found'
  source: 'wikipedia'
  title: string
  description: string | null
  extract: string
  url: string
}

export type WordAnswer =
  | DictionaryEntry
  | WikipediaSummary
  | { state: 'not-found'; searchUrl?: string }
  | { state: 'ambiguous'; title: string; url: string }

export type WordErrorCode = 'signed_out' | 'not_found' | 'invalid' | 'rate' | 'busy' | 'unavailable' | 'failed'

export interface TranslateRequest {
  book: string
  text: string
  context?: string
  to: TranslateLanguage
}

export interface TranslateAnswer {
  translation: string
  model: string
}

export type TranslateErrorCode =
  | 'signed_out'
  | 'not_found'
  | 'invalid'
  | 'no_key'
  | 'rate'
  | 'key_rejected'
  | 'billing'
  | 'refused'
  | 'busy'
  | 'failed'
