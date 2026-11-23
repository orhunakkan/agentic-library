import { describe, expect, it } from 'vitest'
import {
  EXPLAIN_HIGHLIGHTS,
  EXPLAIN_QUESTION,
  FLASHCARDS_QUESTION,
  QUIZ_QUESTION,
  quickQuestions,
  RECAP_QUESTION,
  REMIND,
  type Suggestion,
  suggestions,
  summaryQuestion,
} from './suggestions'

const at = { chapterIndex: 3, hasCode: true, highlights: 2, wholeBook: false }
const ids = (list: Suggestion[]) => list.map((s) => s.id)
const byId = (list: Suggestion[], id: Suggestion['id']) => list.find((s) => s.id === id)

describe('suggestions', () => {
  it('lists summary, recap, quiz, flashcards, code, remind and highlights, in that order', () => {
    expect(ids(suggestions(at))).toEqual(['summary', 'recap', 'quiz', 'flashcards', 'code', 'remind', 'highlights'])
  })

  it('labels and asks for the summary by the whole-book switch', () => {
    expect(byId(suggestions(at), 'summary')).toEqual({
      kind: 'ask',
      id: 'summary',
      label: 'Summarise this chapter so far',
      question: 'Summarise this chapter so far.',
      action: 'summary',
    })
    expect(byId(suggestions({ ...at, wholeBook: true }), 'summary')).toMatchObject({
      label: 'Summarise this chapter',
      question: 'Summarise this chapter.',
    })
    expect(summaryQuestion(false)).toBe('Summarise this chapter so far.')
    expect(summaryQuestion(true)).toBe('Summarise this chapter.')
  })

  it('offers the recap only from the second chapter on', () => {
    expect(byId(suggestions({ ...at, chapterIndex: 0 }), 'recap')).toBeUndefined()
    expect(byId(suggestions({ ...at, chapterIndex: 1 }), 'recap')).toEqual({
      kind: 'ask',
      id: 'recap',
      label: 'Recap the book so far',
      question: RECAP_QUESTION,
      action: 'recap',
    })
    expect(RECAP_QUESTION).toBe('Recap the book so far.')
  })

  it('offers the code example only with code, and the highlights only when there are some', () => {
    expect(byId(suggestions({ ...at, hasCode: false }), 'code')).toBeUndefined()
    expect(byId(suggestions(at), 'code')).toMatchObject({ question: 'Explain the last code example.' })
    expect(byId(suggestions({ ...at, highlights: 0 }), 'highlights')).toBeUndefined()
    expect(byId(suggestions(at), 'highlights')).toMatchObject({
      kind: 'ask',
      question: EXPLAIN_HIGHLIGHTS,
      highlights: true,
      hint: 'Sends your highlights and notes in this chapter with the question.',
    })
    expect(ids(suggestions({ chapterIndex: 0, hasCode: false, highlights: 0, wholeBook: false }))).toEqual([
      'summary',
      'quiz',
      'flashcards',
      'remind',
    ])
  })

  it('offers Quiz me and Make flashcards from the first chapter on, with their actions', () => {
    for (const chapterIndex of [0, 3]) {
      const list = suggestions({ ...at, chapterIndex })
      expect(byId(list, 'quiz')).toEqual({
        kind: 'ask',
        id: 'quiz',
        label: 'Quiz me on this chapter so far',
        question: 'Quiz me on this chapter so far.',
        action: 'quiz',
      })
      expect(byId(list, 'flashcards')).toEqual({
        kind: 'ask',
        id: 'flashcards',
        label: 'Make flashcards from this chapter so far',
        question: 'Make flashcards from this chapter so far.',
        action: 'flashcards',
      })
    }
    expect(QUIZ_QUESTION).toBe('Quiz me on this chapter so far.')
    expect(FLASHCARDS_QUESTION).toBe('Make flashcards from this chapter so far.')
  })

  it('starts the reminder for the reader to finish rather than asking it', () => {
    expect(byId(suggestions(at), 'remind')).toEqual({
      kind: 'start',
      id: 'remind',
      label: 'Remind me what the book has said about …',
      text: REMIND,
    })
  })

  it('labels have no full stop; the questions sent do', () => {
    for (const s of suggestions(at)) {
      expect(s.label.endsWith('.')).toBe(false)
      if (s.kind === 'ask') expect(s.question.endsWith('.')).toBe(true)
    }
    expect(EXPLAIN_QUESTION).toBe('Explain this passage in plain words.')
  })
})

describe('quickQuestions', () => {
  it('gives Summarise chapter and Recap so far, asking what the full suggestions ask', () => {
    for (const wholeBook of [false, true]) {
      const quick = quickQuestions({ chapterIndex: 2, wholeBook })
      const full = suggestions({ ...at, chapterIndex: 2, wholeBook })
      expect(quick.map((s) => s.label)).toEqual(['Summarise chapter', 'Recap so far', 'Quiz me', 'Flashcards'])
      for (const id of ['summary', 'recap', 'quiz', 'flashcards'] as const) {
        const { label: _q, ...quickRest } = byId(quick, id) as Suggestion
        const { label: _f, ...fullRest } = byId(full, id) as Suggestion
        expect(quickRest).toEqual(fullRest)
      }
    }
  })

  it('follows the same chapter rule for the recap', () => {
    expect(ids(quickQuestions({ chapterIndex: 0, wholeBook: false }))).toEqual(['summary', 'quiz', 'flashcards'])
    expect(ids(quickQuestions({ chapterIndex: 1, wholeBook: true }))).toEqual([
      'summary',
      'recap',
      'quiz',
      'flashcards',
    ])
  })
})
