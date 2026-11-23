import { isBookSlug } from '../../shared/content/book-slug.ts'
import type { WordSource } from '../../shared/lookup/contract.ts'
import { isTranslateLanguage, type TranslateLanguage } from '../../shared/lookup/languages.ts'
import { collapse, lookupTerm, PASSAGE_MAX } from '../../shared/lookup/term.ts'
import { clean, isObject, only } from '../ask/input.ts'

const RAW_TERM_MAX = 200

export interface WordInput {
  book: string
  term: string
  source: WordSource
}

export interface TranslateInput {
  book: string
  text: string
  kind: 'term' | 'passage'
  context: string | null
  to: TranslateLanguage
}

const length = (text: string) => [...text].length

export function parseWordInput(value: unknown): WordInput | null {
  if (!isObject(value) || !only(value, ['book', 'term', 'source'])) return null
  const { book, term, source } = value
  if (!isBookSlug(book) || typeof term !== 'string' || length(term) > RAW_TERM_MAX) return null
  if (source !== 'dictionary' && source !== 'wikipedia') return null
  const normalised = lookupTerm(clean(term))
  return normalised ? { book, term: normalised, source } : null
}

export function parseTranslateInput(value: unknown): TranslateInput | null {
  if (!isObject(value) || !only(value, ['book', 'text', 'context', 'to'])) return null
  const { book, to } = value
  if (!isBookSlug(book) || !isTranslateLanguage(to) || typeof value.text !== 'string') return null
  const text = clean(value.text)
  const collapsed = collapse(text)
  if (!collapsed || length(collapsed) > PASSAGE_MAX) return null
  if (value.context !== undefined && typeof value.context !== 'string') return null
  const context = typeof value.context === 'string' ? collapse(clean(value.context)) : ''
  if (length(context) > PASSAGE_MAX) return null
  const term = lookupTerm(text)
  return term
    ? { book, text: term, kind: 'term', context: context || null, to }
    : { book, text, kind: 'passage', context: null, to }
}
