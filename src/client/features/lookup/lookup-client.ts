import { isObject } from '~/shared/lib/json-shape'
import type {
  Definition,
  Sense,
  TranslateAnswer,
  TranslateRequest,
  WordAnswer,
  WordRequest,
} from '~/shared/lookup/contract'
import { post } from '../../lib/post'

export type WordProblem = 'signed_out' | 'not_found' | 'rate' | 'busy' | 'unavailable' | 'network' | 'failed'
export type TranslateProblem =
  | 'signed_out'
  | 'pro'
  | 'not_found'
  | 'no_key'
  | 'rate'
  | 'key_rejected'
  | 'billing'
  | 'refused'
  | 'busy'
  | 'network'
  | 'failed'

export type LookupResult<T, P extends string> = { ok: true; value: T } | { ok: false; problem: P; retryAt?: Date }

const WORD_CODES: readonly WordProblem[] = ['signed_out', 'not_found', 'rate', 'busy', 'unavailable']
const TRANSLATE_CODES: readonly TranslateProblem[] = [
  'signed_out',
  'pro',
  'not_found',
  'no_key',
  'rate',
  'key_rejected',
  'billing',
  'refused',
  'busy',
]

type Json = Record<string, unknown>
const isText = (value: unknown): value is string => typeof value === 'string'

function isDefinition(value: unknown): value is Definition {
  return isObject(value) && isText(value.text) && (value.lemma === undefined || isText(value.lemma))
}

function isSense(value: unknown): value is Sense {
  return (
    isObject(value) &&
    isText(value.partOfSpeech) &&
    Array.isArray(value.definitions) &&
    value.definitions.every(isDefinition)
  )
}

function isWordAnswer(body: Json): boolean {
  if (body.state === 'not-found') return body.searchUrl === undefined || isText(body.searchUrl)
  if (body.state === 'ambiguous') return isText(body.title) && isText(body.url)
  if (body.state !== 'found' || !isText(body.url)) return false
  if (body.source === 'dictionary')
    return (
      isText(body.term) &&
      isText(body.language) &&
      isText(body.languageName) &&
      typeof body.otherLanguage === 'boolean' &&
      Array.isArray(body.senses) &&
      body.senses.every(isSense)
    )
  if (body.source === 'wikipedia')
    return isText(body.title) && isText(body.extract) && (body.description === null || isText(body.description))
  return false
}

export function wordAnswerOf(body: Json): WordAnswer | undefined {
  return isWordAnswer(body) ? (body as WordAnswer) : undefined
}

async function send<T, P extends string>(
  path: string,
  request: unknown,
  codes: readonly P[],
  pick: (body: Json) => T | undefined,
): Promise<LookupResult<T, P | 'network' | 'failed'>> {
  let response: Response
  try {
    response = await post(path, request)
  } catch {
    return { ok: false, problem: 'network' }
  }
  const body = await response.json().catch(() => null)
  if (!isObject(body)) return { ok: false, problem: 'failed' }
  if (response.ok) {
    const value = pick(body)
    return value === undefined ? { ok: false, problem: 'failed' } : { ok: true, value }
  }
  const code = codes.find((c) => c === body.error)
  if (!code) return { ok: false, problem: 'failed' }
  const retryAt = code === 'rate' && isText(body.retryAt) ? new Date(body.retryAt) : null
  return retryAt && !Number.isNaN(retryAt.getTime())
    ? { ok: false, problem: code, retryAt }
    : { ok: false, problem: code }
}

export function lookUpWord(request: WordRequest): Promise<LookupResult<WordAnswer, WordProblem>> {
  return send('/account/lookup/word', request, WORD_CODES, wordAnswerOf)
}

export function translate(request: TranslateRequest): Promise<LookupResult<TranslateAnswer, TranslateProblem>> {
  return send('/account/lookup/translate', request, TRANSLATE_CODES, (body) =>
    isText(body.translation) && isText(body.model) ? { translation: body.translation, model: body.model } : undefined,
  )
}
