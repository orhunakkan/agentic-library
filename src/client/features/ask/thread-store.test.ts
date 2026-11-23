import { describe, expect, it } from 'vitest'
import {
  clearPrivateThreads,
  clearThread,
  emptyThread,
  loadThread,
  MAX_TURNS,
  parseThread,
  saveThread,
  type Thread,
  threadKey,
} from './thread-store'

function memoryStorage(full = false): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      if (full) throw new DOMException('quota', 'QuotaExceededError')
      data.set(k, v)
    },
    removeItem: (k) => {
      data.delete(k)
    },
    clear: () => data.clear(),
  }
}

const blocked = new Proxy({} as Storage, {
  get() {
    throw new DOMException('blocked', 'SecurityError')
  },
})

const turn = (i: number, role: 'user' | 'assistant' = i % 2 ? 'assistant' : 'user') => ({
  role,
  text: `turn ${i}`,
  citations: [],
  at: 1_000 + i,
})

describe('the thread store', () => {
  it('saves and loads a thread per book', () => {
    const storage = memoryStorage()
    const thread: Thread = {
      v: 1,
      wholeBook: true,
      turns: [
        turn(0),
        {
          ...turn(1),
          citations: [{ pageHref: '/read/b/functions/3', label: 'Ch. 4 · p. 3', citedText: 'x' }],
          stopped: true,
        },
      ],
    }
    expect(saveThread(storage, 'b', thread)).toBe(true)
    expect(storage.getItem(threadKey('b'))).not.toBeNull()
    expect(loadThread(storage, 'b')).toEqual(thread)
    expect(loadThread(storage, 'other')).toEqual(emptyThread())
  })

  it('keeps at most 20 turns, dropping the oldest', () => {
    const storage = memoryStorage()
    const turns = Array.from({ length: MAX_TURNS + 5 }, (_, i) => turn(i))
    saveThread(storage, 'b', { v: 1, wholeBook: false, turns })
    const loaded = loadThread(storage, 'b')
    expect(loaded.turns).toHaveLength(MAX_TURNS)
    expect(loaded.turns[0]?.text).toBe('turn 5')
    expect(parseThread(JSON.stringify({ v: 1, turns })).turns).toHaveLength(MAX_TURNS)
  })

  it('reads bad JSON, other versions and malformed turns as nothing, keeping the good turns', () => {
    expect(parseThread('{oops')).toEqual(emptyThread())
    expect(parseThread(JSON.stringify({ v: 2, turns: [turn(0)] }))).toEqual(emptyThread())
    const mixed = parseThread(
      JSON.stringify({
        v: 1,
        wholeBook: 'yes',
        turns: [
          turn(0),
          { role: 'system', text: 'x', at: 1 },
          { role: 'user', text: 5, at: 1 },
          { ...turn(1), citations: [{ pageHref: 'https://evil.example/', label: 'x', citedText: 'x' }] },
        ],
      }),
    )
    expect(mixed).toEqual({ v: 1, wholeBook: false, turns: [turn(0), turn(1)] })
  })

  it('treats a full or blocked store as no memory, without throwing', () => {
    expect(saveThread(memoryStorage(true), 'b', emptyThread())).toBe(false)
    expect(saveThread(blocked, 'b', emptyThread())).toBe(false)
    expect(saveThread(null, 'b', emptyThread())).toBe(false)
    expect(loadThread(blocked, 'b')).toEqual(emptyThread())
    expect(() => clearThread(blocked, 'b')).not.toThrow()
    expect(() => clearPrivateThreads(blocked)).not.toThrow()
  })

  it('clears one book, or every private book on sign-out', () => {
    const storage = memoryStorage()
    for (const slug of ['pride-and-prejudice', 'u-1111', 'u-2222']) saveThread(storage, slug, emptyThread())
    storage.setItem('recent-reading', '[]')
    clearThread(storage, 'u-1111')
    expect(storage.getItem(threadKey('u-1111'))).toBeNull()
    clearPrivateThreads(storage)
    expect(storage.getItem(threadKey('u-2222'))).toBeNull()
    expect(storage.getItem(threadKey('pride-and-prejudice'))).not.toBeNull()
    expect(storage.getItem('recent-reading')).toBe('[]')
  })
})

describe('a quiz or flashcards turn', () => {
  const source = { position: { chapter: 'chapter-3', page: 2 }, label: 'Ch. 3 · p. 2' }
  const citation = { pageHref: '/read/b/chapter-3/2', label: 'Ch. 3 · p. 2', citedText: 'x' }
  const question = {
    question: 'Q?',
    choices: ['a', 'b', 'c', 'd'],
    answer: 2,
    why: 'Because.',
    citations: [citation],
    source,
    picked: 1,
  }
  const quizTurn = { role: 'assistant', text: 'Quiz on this chapter so far: …', citations: [], at: 5 }
  const stored = (study: unknown, extra: object[] = []) =>
    JSON.stringify({ v: 1, wholeBook: false, turns: [...extra, { ...quizTurn, study }] })

  it('round-trips with the picks', () => {
    const study = { kind: 'quiz', span: 'two', questions: [question, { ...question, picked: null }] }
    const thread = parseThread(stored(study))
    expect(thread.turns[0]?.study).toEqual(study)
    const cards = { kind: 'cards', span: 'chapter', cards: [{ front: 'f', back: 'b', citations: [citation], source }] }
    expect(parseThread(stored(cards)).turns[0]?.study).toEqual(cards)
    expect(
      parseThread(
        stored({ ...cards, cards: [{ ...cards.cards[0], source: { position: { printedPage: 4 }, label: 'p. 4' } }] }),
      ).turns[0]?.study,
    ).toBeDefined()
  })

  it('drops a turn whose study is malformed, and keeps the rest', () => {
    const before = { role: 'user', text: 'Quiz me.', citations: [], at: 4 }
    const bad = [
      { kind: 'quiz', span: 'chapter', questions: [{ ...question, choices: ['a', 'b', 'c'] }] },
      { kind: 'quiz', span: 'chapter', questions: [{ ...question, answer: 4 }] },
      { kind: 'quiz', span: 'chapter', questions: [{ ...question, picked: 7 }] },
      {
        kind: 'quiz',
        span: 'chapter',
        questions: [{ ...question, citations: [{ ...citation, pageHref: 'https://evil.example' }] }],
      },
      { kind: 'quiz', span: 'chapter', questions: [{ ...question, source: { label: 'x' } }] },
      { kind: 'quiz', span: 'everything', questions: [question] },
      { kind: 'quiz', span: 'chapter', questions: [] },
      { kind: 'cards', span: 'chapter', cards: [{ front: 1, back: 'b', citations: [], source }] },
      { kind: 'essay', span: 'chapter' },
      'quiz',
    ]
    for (const study of bad) {
      expect(parseThread(stored(study, [before])).turns, JSON.stringify(study)).toEqual([before])
    }
  })

  it('leaves older threads without a study as they were', () => {
    const old = { v: 1, wholeBook: true, turns: [quizTurn] }
    expect(parseThread(JSON.stringify(old)).turns[0]).toEqual(quizTurn)
    expect(parseThread(JSON.stringify(old)).turns[0]).not.toHaveProperty('study')
  })
})
