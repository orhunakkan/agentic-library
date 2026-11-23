import type { AskAction } from './ask-client'

export const EXPLAIN_QUESTION = 'Explain this passage in plain words.'
export const RECAP_QUESTION = 'Recap the book so far.'
export const summaryQuestion = (wholeBook: boolean) =>
  wholeBook ? 'Summarise this chapter.' : 'Summarise this chapter so far.'
export const EXPLAIN_HIGHLIGHTS = 'Explain my highlights in this chapter.'
export const REMIND = 'Remind me what the book has said about '
const EXPLAIN_CODE = 'Explain the last code example.'
export const QUIZ_QUESTION = 'Quiz me on this chapter so far.'
export const FLASHCARDS_QUESTION = 'Make flashcards from this chapter so far.'

export type Suggestion =
  | {
      kind: 'ask'
      id: 'summary' | 'recap' | 'quiz' | 'flashcards' | 'code' | 'highlights'
      label: string
      hint?: string
      question: string
      action?: Extract<AskAction, 'summary' | 'recap' | 'quiz' | 'flashcards'>
      highlights?: true
    }
  | { kind: 'start'; id: 'remind'; label: string; text: string }

const summary = (wholeBook: boolean, label: string): Suggestion => ({
  kind: 'ask',
  id: 'summary',
  label,
  question: summaryQuestion(wholeBook),
  action: 'summary',
})

const recap = (label: string): Suggestion => ({
  kind: 'ask',
  id: 'recap',
  label,
  question: RECAP_QUESTION,
  action: 'recap',
})

const quiz = (label: string): Suggestion => ({
  kind: 'ask',
  id: 'quiz',
  label,
  question: QUIZ_QUESTION,
  action: 'quiz',
})

const flashcards = (label: string): Suggestion => ({
  kind: 'ask',
  id: 'flashcards',
  label,
  question: FLASHCARDS_QUESTION,
  action: 'flashcards',
})

export function suggestions(at: {
  chapterIndex: number
  hasCode: boolean
  highlights: number
  wholeBook: boolean
}): Suggestion[] {
  const list: Suggestion[] = [
    summary(at.wholeBook, at.wholeBook ? 'Summarise this chapter' : 'Summarise this chapter so far'),
  ]
  if (at.chapterIndex > 0) list.push(recap('Recap the book so far'))
  list.push(quiz('Quiz me on this chapter so far'), flashcards('Make flashcards from this chapter so far'))
  if (at.hasCode) list.push({ kind: 'ask', id: 'code', label: 'Explain the last code example', question: EXPLAIN_CODE })
  list.push({ kind: 'start', id: 'remind', label: 'Remind me what the book has said about …', text: REMIND })
  if (at.highlights > 0) {
    list.push({
      kind: 'ask',
      id: 'highlights',
      label: 'Explain my highlights in this chapter',
      hint: 'Sends your highlights and notes in this chapter with the question.',
      question: EXPLAIN_HIGHLIGHTS,
      highlights: true,
    })
  }
  return list
}

export function quickQuestions(at: { chapterIndex: number; wholeBook: boolean }): Suggestion[] {
  return [
    summary(at.wholeBook, 'Summarise chapter'),
    ...(at.chapterIndex > 0 ? [recap('Recap so far')] : []),
    quiz('Quiz me'),
    flashcards('Flashcards'),
  ]
}
