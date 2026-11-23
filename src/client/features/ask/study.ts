import { type CardDraft, type QuizQuestion, type StudySpan, withoutMarkers } from '~/shared/ask/events'
import { BACK_MAX } from '~/shared/flashcards/limits'
import type { ThreadQuestion, ThreadStudy } from './thread-store'

const LETTERS = ['A', 'B', 'C', 'D'] as const
export const letter = (index: number) => LETTERS[index] ?? '?'

const where = (span: StudySpan) => (span === 'two' ? 'this chapter so far and the one before' : 'this chapter so far')

export function studyHeading(study: ThreadStudy): string {
  const n = study.kind === 'quiz' ? study.questions.length : study.cards.length
  if (study.kind === 'quiz') return `${n} ${n === 1 ? 'question' : 'questions'} on ${where(study.span)}`
  return `${n} ${n === 1 ? 'flashcard' : 'flashcards'} from ${where(study.span)}`
}

export function newQuiz(span: StudySpan, questions: readonly QuizQuestion[]): ThreadStudy {
  return { kind: 'quiz', span, questions: questions.map((q) => ({ ...q, picked: null })) }
}

export function pick(study: ThreadStudy, index: number, choice: number): ThreadStudy {
  if (study.kind !== 'quiz' || choice < 0 || choice > 3 || !Number.isInteger(choice)) return study
  const question = study.questions[index]
  if (!question || question.picked !== null) return study
  return { ...study, questions: study.questions.map((q, i) => (i === index ? { ...q, picked: choice } : q)) }
}

const isRight = (q: ThreadQuestion) => q.picked === q.answer

export function score(study: ThreadStudy): { right: number; answered: number; total: number; done: boolean } {
  if (study.kind !== 'quiz') return { right: 0, answered: 0, total: 0, done: false }
  const answered = study.questions.filter((q) => q.picked !== null).length
  const total = study.questions.length
  return { right: study.questions.filter(isRight).length, answered, total, done: answered === total }
}

export const verdict = (q: ThreadQuestion) => (isRight(q) ? 'Right.' : `Not quite. The answer is ${letter(q.answer)}.`)

export function scoreLine(study: ThreadStudy): string {
  const { right, total } = score(study)
  return `You got ${right} of ${total} right.`
}

function cut(text: string, max: number): string {
  const chars = [...text]
  if (chars.length <= max) return text
  const head = chars.slice(0, max - 1).join('')
  const space = head.lastIndexOf(' ')
  return `${(space > head.length * 0.6 ? head.slice(0, space) : head).trimEnd()}…`
}

export function cardFromQuestion(q: QuizQuestion): Pick<CardDraft, 'front' | 'back' | 'source'> {
  const right = (q.choices[q.answer] ?? '').replace(/[.!?]+$/, '')
  return { front: q.question, back: cut(`${right}. ${withoutMarkers(q.why)}`, BACK_MAX), source: q.source }
}

export function studyText(study: ThreadStudy): string {
  if (study.kind === 'quiz') {
    const items = study.questions.map(
      (q, i) =>
        `${i + 1}. ${q.question}\n${q.choices.map((c, j) => `${letter(j)}) ${c}`).join('\n')}\nRight answer: ${letter(q.answer)}. Why: ${withoutMarkers(q.why)}`,
    )
    return `Quiz on ${where(study.span)}:\n\n${items.join('\n\n')}`
  }
  const items = study.cards.map((c, i) => `${i + 1}. ${c.front}\n${withoutMarkers(c.back)}`)
  return `Flashcards from ${where(study.span)}:\n\n${items.join('\n\n')}`
}
