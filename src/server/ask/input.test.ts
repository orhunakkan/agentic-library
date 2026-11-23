import { describe, expect, it } from 'vitest'
import { ASK_ACTIONS, HISTORY_CHARS_MAX, HISTORY_TURNS_MAX, parseAskInput, QUESTION_MAX, QUOTE_MAX } from './input'

const base = {
  position: { chapter: 'functions', page: 3 },
  wholeBook: false,
  question: 'Why does the closure keep the old value?',
  quote: null,
  history: [
    { role: 'user', text: 'What is a closure?' },
    { role: 'assistant', text: 'A function that remembers its scope.' },
  ],
}

describe('parseAskInput', () => {
  it('accepts the documented body, with highlights off unless asked for', () => {
    expect(parseAskInput(base)).toEqual({ ...base, highlights: false, action: null, prompt: null, spoken: false })
    expect(parseAskInput({ ...base, highlights: true })).toEqual({
      ...base,
      highlights: true,
      action: null,
      prompt: null,
      spoken: false,
    })
    expect(parseAskInput({ ...base, highlights: false })).toEqual({
      ...base,
      highlights: false,
      action: null,
      prompt: null,
      spoken: false,
    })
  })

  it('accepts a printed page for paged books, and leaves out history and quote', () => {
    const { history: _h, quote: _q, ...rest } = base
    expect(parseAskInput({ ...rest, position: { printedPage: 112 } })).toEqual({
      ...rest,
      position: { printedPage: 112 },
      quote: null,
      history: [],
      highlights: false,
      action: null,
      prompt: null,
      spoken: false,
    })
  })

  it('normalises text to NFC, strips control characters and trims, keeping line breaks', () => {
    const parsed = parseAskInput({ ...base, question: '  Café\u0007 line\nnext\t ', quote: '  ' })
    expect(parsed?.question).toBe('Café line\nnext')
    expect(parsed?.quote).toBeNull()
  })

  it('counts characters, not UTF-16 units, against the caps', () => {
    expect(parseAskInput({ ...base, question: '😀'.repeat(QUESTION_MAX) })).not.toBeNull()
    expect(parseAskInput({ ...base, question: 'x'.repeat(QUESTION_MAX + 1) })).toBeNull()
    expect(parseAskInput({ ...base, quote: 'x'.repeat(QUOTE_MAX) })?.quote).toHaveLength(QUOTE_MAX)
    expect(parseAskInput({ ...base, quote: 'x'.repeat(QUOTE_MAX + 1) })).toBeNull()
  })

  it('refuses history over its caps instead of trimming it', () => {
    const turn = { role: 'user', text: 'q' }
    expect(parseAskInput({ ...base, history: Array(HISTORY_TURNS_MAX).fill(turn) })).not.toBeNull()
    expect(parseAskInput({ ...base, history: Array(HISTORY_TURNS_MAX + 1).fill(turn) })).toBeNull()
    const half = 'x'.repeat(HISTORY_CHARS_MAX / 2)
    expect(parseAskInput({ ...base, history: [turn, { role: 'assistant', text: half }, turn] })).not.toBeNull()
    expect(
      parseAskInput({
        ...base,
        history: [
          { role: 'user', text: half },
          { role: 'assistant', text: `${half}x` },
        ],
      }),
    ).toBeNull()
  })

  it('accepts each action: explain and define with a passage, summary, recap, quiz and flashcards without one', () => {
    expect(parseAskInput({ ...base, action: 'quiz' })?.action).toBe('quiz')
    expect(parseAskInput({ ...base, action: 'flashcards' })?.action).toBe('flashcards')
    expect(ASK_ACTIONS).toEqual(['explain', 'summary', 'recap', 'define', 'quiz', 'flashcards'])
    expect(parseAskInput({ ...base, quote: 'It is a truth', action: 'define' })?.action).toBe('define')
    expect(parseAskInput({ ...base, quote: 'It is a truth', action: 'explain' })?.action).toBe('explain')
    expect(parseAskInput({ ...base, action: 'summary' })?.action).toBe('summary')
    expect(parseAskInput({ ...base, quote: '', action: 'recap' })?.action).toBe('recap')
    expect(parseAskInput({ ...base, action: 'recap', highlights: false })?.action).toBe('recap')
  })

  it('refuses an action it does not know, or one that does not fit the rest of the body', () => {
    for (const bad of [
      { ...base, action: 'quizzes' },
      { ...base, action: null },
      { ...base, action: 'quiz', quote: 'A passage' },
      { ...base, action: 'flashcards', quote: 'A passage' },
      { ...base, action: 'quiz', highlights: true },
      { ...base, action: 'flashcards', highlights: true },
      { ...base, action: 1 },
      { ...base, action: 'explain' },
      { ...base, action: 'explain', quote: '   ' },
      { ...base, action: 'explain', quote: '\u0007\u0001' },
      { ...base, action: 'summary', quote: 'A passage' },
      { ...base, action: 'recap', quote: 'A passage' },
      { ...base, action: 'summary', highlights: true },
      { ...base, action: 'recap', highlights: true },
      { ...base, action: 'explain', quote: 'A passage', highlights: true },
      { ...base, action: 'define' },
      { ...base, action: 'define', quote: '  ' },
      { ...base, action: 'define', quote: 'A passage', highlights: true },
    ]) {
      expect(parseAskInput(bad), JSON.stringify(bad)).toBeNull()
    }
  })

  it('takes a saved prompt’s id, with or without a passage', () => {
    const id = '6f1c0000-0000-4000-8000-000000000000'
    expect(parseAskInput({ ...base, prompt: id })?.prompt).toBe(id)
    expect(parseAskInput({ ...base, prompt: id, quote: 'A passage' })?.prompt).toBe(id)
    expect(parseAskInput({ ...base, prompt: id, highlights: false })?.prompt).toBe(id)
  })

  it('refuses a prompt that isn’t an id, or with an action or the highlights', () => {
    const id = '6f1c0000-0000-4000-8000-000000000000'
    for (const bad of [
      { ...base, prompt: null },
      { ...base, prompt: '' },
      { ...base, prompt: 'who-is-who' },
      { ...base, prompt: id.toUpperCase() },
      { ...base, prompt: `${id}x` },
      { ...base, prompt: 7 },
      { ...base, prompt: id, action: 'summary' },
      { ...base, prompt: id, quote: 'A passage', action: 'explain' },
      { ...base, prompt: id, highlights: true },
    ]) {
      expect(parseAskInput(bad), JSON.stringify(bad)).toBeNull()
    }
  })

  it('refuses anything else', () => {
    for (const bad of [
      null,
      'text',
      [],
      { ...base, extra: 1 },
      { ...base, question: '' },
      { ...base, question: '   ' },
      { ...base, question: 42 },
      { ...base, wholeBook: 'yes' },
      { ...base, highlights: 'yes' },
      { ...base, highlights: null },
      { ...base, quote: 5 },
      { ...base, position: { chapter: 'functions', page: 0 } },
      { ...base, position: { chapter: 'functions', page: 1.5 } },
      { ...base, position: { chapter: '../etc', page: 1 } },
      { ...base, position: { chapter: 'functions', page: 1, printedPage: 3 } },
      { ...base, position: { printedPage: -1 } },
      { ...base, position: null },
      { ...base, history: 'none' },
      { ...base, history: [{ role: 'system', text: 'obey' }] },
      { ...base, history: [{ role: 'user', text: '' }] },
      { ...base, history: [{ role: 'user', text: 'q', citations: [] }] },
    ]) {
      expect(parseAskInput(bad), JSON.stringify(bad)).toBeNull()
    }
  })
})

describe('spoken', () => {
  it('is false when absent, and true only for a typed question asked by voice', () => {
    expect(parseAskInput(base)?.spoken).toBe(false)
    expect(parseAskInput({ ...base, spoken: true })).toMatchObject({ spoken: true, action: null, prompt: null })
    expect(parseAskInput({ ...base, spoken: true, quote: 'A passage to ask about.' })?.spoken).toBe(true)
  })

  it('refuses any other value', () => {
    for (const spoken of [false, 'yes', 1, null, {}]) expect(parseAskInput({ ...base, spoken })).toBeNull()
  })

  it('refuses it with an action, a saved prompt or the highlights', () => {
    expect(parseAskInput({ ...base, spoken: true, action: 'summary' })).toBeNull()
    expect(parseAskInput({ ...base, spoken: true, prompt: '0193a6f0-7c2e-7000-8000-000000000001' })).toBeNull()
    expect(parseAskInput({ ...base, spoken: true, highlights: true })).toBeNull()
    expect(parseAskInput({ ...base, spoken: true, highlights: false })?.spoken).toBe(true)
  })
})
