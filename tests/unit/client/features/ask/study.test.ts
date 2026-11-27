import { describe, expect, it } from 'vitest'
import {
  cardFromQuestion,
  newQuiz,
  pick,
  score,
  scoreLine,
  studyHeading,
  studyText,
  verdict,
} from '~/client/features/ask/study'
import { citationMarker, type QuizQuestion } from '~/shared/ask/events'

const source = { position: { chapter: 'chapter-3', page: 2 }, label: 'Ch. 3 · p. 2' }
const question = (n: number, answer: 0 | 1 | 2 | 3 = 1): QuizQuestion => ({
  question: `Question ${n}?`,
  choices: [`a${n}`, `b${n}`, `c${n}`, `d${n}`],
  answer,
  why: `Because ${n}.${citationMarker(0)}`,
  citations: [{ pageHref: '/read/b/c/2', label: 'Ch. 3 · p. 2', citedText: 'x' }],
  source,
})

describe('a quiz in the thread', () => {
  it('takes one pick per question and never changes it', () => {
    let quiz = newQuiz('chapter', [question(1), question(2, 2), question(3)])
    quiz = pick(quiz, 0, 1)
    expect(pick(quiz, 0, 3)).toBe(quiz)
    expect(pick(quiz, 9, 0)).toBe(quiz)
    expect(pick(quiz, 1, 4)).toBe(quiz)
    quiz = pick(quiz, 1, 0)
    expect(quiz.kind === 'quiz' && quiz.questions.map((q) => q.picked)).toEqual([1, 0, null])
    expect(score(quiz)).toEqual({ right: 1, answered: 2, total: 3, done: false })
    quiz = pick(quiz, 2, 1)
    expect(score(quiz)).toMatchObject({ right: 2, done: true })
    expect(scoreLine(quiz)).toBe('You got 2 of 3 right.')
    if (quiz.kind !== 'quiz') throw new Error('not a quiz')
    expect(verdict(quiz.questions[0] as never)).toBe('Right.')
    expect(verdict(quiz.questions[1] as never)).toBe('Not quite. The answer is C.')
  })

  it('has a heading for each kind and span', () => {
    const five = newQuiz(
      'chapter',
      [1, 2, 3, 4, 5].map((n) => question(n)),
    )
    expect(studyHeading(five)).toBe('5 questions on this chapter so far')
    expect(studyHeading({ ...five, span: 'two' })).toBe('5 questions on this chapter so far and the one before')
    const cards = {
      kind: 'cards' as const,
      span: 'two' as const,
      cards: [{ front: 'f', back: 'b', citations: [], source }],
    }
    expect(studyHeading(cards)).toBe('1 flashcard from this chapter so far and the one before')
    expect(studyHeading({ ...cards, span: 'chapter', cards: [...cards.cards, ...cards.cards] })).toBe(
      '2 flashcards from this chapter so far',
    )
    expect(score(cards)).toEqual({ right: 0, answered: 0, total: 0, done: false })
  })

  it('renders as plain text for history, without citation markers', () => {
    const text = studyText(newQuiz('chapter', [question(1), question(2, 3)]))
    expect(text).toBe(
      'Quiz on this chapter so far:\n\n1. Question 1?\nA) a1\nB) b1\nC) c1\nD) d1\nRight answer: B. Why: Because 1.\n\n2. Question 2?\nA) a2\nB) b2\nC) c2\nD) d2\nRight answer: D. Why: Because 2.',
    )
    const cards = studyText({
      kind: 'cards',
      span: 'two',
      cards: [{ front: 'Term', back: `Meaning.${citationMarker(0)}`, citations: [], source }],
    })
    expect(cards).toBe('Flashcards from this chapter so far and the one before:\n\n1. Term\nMeaning.')
  })
})

describe('cardFromQuestion', () => {
  it('puts the question on the front, the right choice and the reason on the back', () => {
    expect(cardFromQuestion(question(1))).toEqual({ front: 'Question 1?', back: 'b1. Because 1.', source })
    expect(cardFromQuestion({ ...question(1), choices: ['a', 'It was spring.', 'c', 'd'] }).back).toBe(
      'It was spring. Because 1.',
    )
  })

  it('cuts the back to 500 characters', () => {
    const long = cardFromQuestion({ ...question(1), why: `${'word '.repeat(200)}${citationMarker(0)}` })
    expect([...long.back].length).toBeLessThanOrEqual(500)
    expect(long.back.endsWith('…')).toBe(true)
    expect(long.back.startsWith('b1. word word')).toBe(true)
  })
})
