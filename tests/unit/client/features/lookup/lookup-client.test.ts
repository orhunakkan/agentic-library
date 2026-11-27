import { describe, expect, it, vi } from 'vitest'
import { lookUpWord, translate, wordAnswerOf } from '~/client/features/lookup/lookup-client'
import type {
  DictionaryEntry,
  TranslateAnswer,
  TranslateErrorCode,
  WikipediaSummary,
  WordAnswer,
  WordErrorCode,
} from '~/shared/lookup/contract'
import type { ErrorAnswer } from '../../../../support/client/answers'

const WORD = { book: 'pride-and-prejudice', term: 'chaise', source: 'dictionary' } as const
const TEXT = { book: 'pride-and-prejudice', text: 'chaise', context: 'In a chaise and four.', to: 'tr' } as const

const ENTRY = {
  state: 'found',
  source: 'dictionary',
  term: 'chaise',
  language: 'en',
  languageName: 'English',
  otherLanguage: false,
  senses: [{ partOfSpeech: 'Noun', definitions: [{ text: 'A carriage.' }, { text: 'of x', lemma: 'x' }] }],
  url: 'https://en.wiktionary.org/wiki/chaise',
} satisfies DictionaryEntry
const SUMMARY = {
  state: 'found',
  source: 'wikipedia',
  title: 'Chaise',
  description: null,
  extract: 'A chaise is a carriage.',
  url: 'https://en.wikipedia.org/wiki/Chaise',
} satisfies WikipediaSummary

function answer(status: number, body: unknown) {
  const fetch = vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

describe('lookUpWord', () => {
  it('posts the book, the term and the source as JSON', async () => {
    const fetch = answer(200, ENTRY)
    expect(await lookUpWord(WORD)).toEqual({ ok: true, value: ENTRY })
    expect(fetch).toHaveBeenCalledWith('/account/lookup/word', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(WORD),
    })
  })

  it('reads each kind of answer', async () => {
    for (const body of [
      SUMMARY,
      { ...SUMMARY, description: 'A carriage' },
      { state: 'not-found' },
      { state: 'not-found', searchUrl: 'https://en.wikipedia.org/w/index.php?search=x' },
      { state: 'ambiguous', title: 'Bennet', url: 'https://en.wikipedia.org/wiki/Bennet' },
    ] satisfies WordAnswer[]) {
      answer(200, body)
      expect(await lookUpWord(WORD)).toEqual({ ok: true, value: body })
    }
  })

  it('maps each refusal to its problem, with when to try again for the limit', async () => {
    for (const [status, error] of [
      [401, 'signed_out'],
      [404, 'not_found'],
      [503, 'busy'],
      [502, 'unavailable'],
    ] as const satisfies readonly (readonly [number, WordErrorCode])[]) {
      answer(status, { error })
      expect(await lookUpWord(WORD)).toEqual({ ok: false, problem: error })
    }
    answer(429, { error: 'rate', retryAt: '2026-11-06T14:05:00.000Z' } satisfies ErrorAnswer<WordErrorCode>)
    expect(await lookUpWord(WORD)).toEqual({
      ok: false,
      problem: 'rate',
      retryAt: new Date('2026-11-06T14:05:00.000Z'),
    })
    answer(429, { error: 'rate', retryAt: 'soon' } satisfies ErrorAnswer<WordErrorCode>)
    expect(await lookUpWord(WORD)).toEqual({ ok: false, problem: 'rate' })
    answer(400, { error: 'invalid' } satisfies ErrorAnswer<WordErrorCode>)
    expect(await lookUpWord(WORD)).toEqual({ ok: false, problem: 'failed' })
    /** A proxy's error page, not JSON. */
    answer(500, 'Internal error')
    expect(await lookUpWord(WORD)).toEqual({ ok: false, problem: 'failed' })
  })

  it('names a network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    expect(await lookUpWord(WORD)).toEqual({ ok: false, problem: 'network' })
  })

  it('treats a malformed answer as a failure', async () => {
    /** Answers that break the contract on purpose, so they're left untyped. */
    for (const body of [
      [],
      { state: 'found' },
      { ...ENTRY, senses: [{ partOfSpeech: 'Noun', definitions: [{ text: 1 }] }] },
      { ...ENTRY, senses: 'none' },
      { ...ENTRY, source: 'oxford' },
      { ...SUMMARY, description: 3 },
      { state: 'ambiguous', title: 'Bennet' },
      { state: 'not-found', searchUrl: 1 },
      { state: 'unknown' },
    ]) {
      answer(200, body)
      expect(await lookUpWord(WORD), JSON.stringify(body)).toEqual({ ok: false, problem: 'failed' })
    }
  })

  it('checks a lemma is text', () => {
    const bad = { ...ENTRY, senses: [{ partOfSpeech: 'Verb', definitions: [{ text: 'of x', lemma: 2 }] }] }
    expect(wordAnswerOf(bad)).toBeUndefined()
  })
})

describe('translate', () => {
  it('posts the text, its sentence, the book and the target, and reads the translation and the model', async () => {
    const fetch = answer(200, { translation: '[tr] chaise', model: 'claude-sonnet-5-5' } satisfies TranslateAnswer)
    expect(await translate(TEXT)).toEqual({
      ok: true,
      value: { translation: '[tr] chaise', model: 'claude-sonnet-5-5' },
    })
    expect(fetch).toHaveBeenCalledWith('/account/lookup/translate', expect.objectContaining({ method: 'POST' }))
  })

  it('maps each refusal to its problem', async () => {
    for (const [status, error] of [
      [401, 'signed_out'],
      [404, 'not_found'],
      [409, 'no_key'],
      [502, 'key_rejected'],
      [502, 'billing'],
      [502, 'refused'],
      [503, 'busy'],
    ] as const satisfies readonly (readonly [number, TranslateErrorCode])[]) {
      answer(status, { error })
      expect(await translate(TEXT)).toEqual({ ok: false, problem: error })
    }
    answer(502, { error: 'failed' } satisfies ErrorAnswer<TranslateErrorCode>)
    expect(await translate(TEXT)).toEqual({ ok: false, problem: 'failed' })
    answer(429, { error: 'rate', retryAt: '2026-11-06T14:05:00.000Z' } satisfies ErrorAnswer<TranslateErrorCode>)
    expect(await translate(TEXT)).toMatchObject({ problem: 'rate', retryAt: new Date('2026-11-06T14:05:00.000Z') })
  })

  it('treats a malformed answer as a failure', async () => {
    /** Breaks the contract on purpose, so it's left untyped. */
    answer(200, { translation: 1, model: 'x' })
    expect(await translate(TEXT)).toEqual({ ok: false, problem: 'failed' })
  })
})
