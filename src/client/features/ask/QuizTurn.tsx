import { Check, X } from 'lucide-react'
import { useState } from 'react'
import { cn } from '~/client/lib/cn'
import { AnswerText } from './AnswerText'
import { SaveCardButton, useCardSaves } from './SaveCardButton'
import { cardFromQuestion, letter, score, scoreLine, studyHeading, verdict } from './study'
import type { ThreadQuestion, ThreadStudy } from './thread-store'

export function QuizTurn({
  study,
  bookSlug,
  busy,
  newQuizOff = null,
  onPick,
  onNewQuiz,
  onNavigate,
}: {
  study: Extract<ThreadStudy, { kind: 'quiz' }>
  bookSlug: string
  busy: boolean
  /** Why a new quiz can't be made now, as with a GPT model; null when it can. */
  newQuizOff?: string | null
  onPick: (question: number, choice: number) => void
  onNewQuiz: () => void
  onNavigate?: () => void
}) {
  const saves = useCardSaves(study.questions.length)
  const [said, setSaid] = useState('')
  const result = score(study)
  return (
    <li className="space-y-4">
      <p className="text-[13.5px] font-medium text-r-muted" data-testid="quiz-heading">
        {studyHeading(study)}
      </p>
      {study.questions.map((q, i) => (
        <Question
          // biome-ignore lint/suspicious/noArrayIndexKey: the questions never move; the index is the question's number
          key={i}
          n={i + 1}
          question={q}
          onPick={(choice) => {
            onPick(i, choice)
            setSaid(verdict({ ...q, picked: choice }))
          }}
          onNavigate={onNavigate}
          save={
            <SaveCardButton
              state={saves.states[i] ?? { state: 'idle' }}
              label="Save as flashcard"
              onSave={() => {
                const { front, back, source } = cardFromQuestion(q)
                void saves.save(i, { book: bookSlug, front, back, position: source.position, origin: 'quiz' })
              }}
            />
          }
        />
      ))}
      {result.done && (
        <div className="flex flex-wrap items-center gap-3 text-[14.5px]">
          <p className="font-medium" data-testid="quiz-score">
            {scoreLine(study)}
          </p>
          <button
            type="button"
            onClick={onNewQuiz}
            disabled={busy || newQuizOff !== null}
            data-testid="quiz-new"
            className="inline-flex h-10 items-center rounded-full border border-r-line px-4 text-[13.5px] font-medium transition hover:border-r-accent/60 disabled:opacity-50"
          >
            New quiz
          </button>
          {newQuizOff && (
            <p className="basis-full text-[12.5px] text-r-muted" data-testid="quiz-new-off">
              {newQuizOff}
            </p>
          )}
        </div>
      )}
      <p className="sr-only" aria-live="polite" data-testid="quiz-status">
        {said}
      </p>
    </li>
  )
}

function Question({
  n,
  question: q,
  onPick,
  onNavigate,
  save,
}: {
  n: number
  question: ThreadQuestion
  onPick: (choice: number) => void
  onNavigate?: () => void
  save: React.ReactNode
}) {
  const answered = q.picked !== null
  return (
    <fieldset
      className="min-w-0 rounded-xl border border-r-line px-3.5 pt-2 pb-3"
      data-testid="quiz-question"
      data-key={n}
    >
      <legend className="px-1 text-[14.5px] leading-snug font-medium [overflow-wrap:anywhere]">
        {n}. {q.question}
      </legend>
      <div className="mt-1 space-y-1.5">
        {q.choices.map((choice, j) => {
          const right = answered && j === q.answer
          const wrong = answered && j === q.picked && j !== q.answer
          return (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: four fixed choices, A to D
              key={j}
              type="button"
              disabled={answered}
              onClick={() => onPick(j)}
              data-testid="quiz-choice"
              data-key={j}
              className={cn(
                'flex w-full items-start gap-2.5 rounded-lg border border-r-line px-3 py-2 text-left text-[14px] leading-snug transition enabled:hover:border-r-accent/60',
                right && 'border-emerald-600/60 bg-emerald-600/10',
                wrong && 'border-red-600/50 bg-red-600/10',
              )}
            >
              <span className="w-4 shrink-0 font-semibold">{letter(j)}</span>
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{choice}</span>
              {right && (
                <span
                  className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium"
                  data-testid="quiz-right-answer"
                >
                  <Check className="size-3.5" aria-hidden />
                  Right answer
                </span>
              )}
              {wrong && (
                <span
                  className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium"
                  data-testid="quiz-your-answer"
                >
                  <X className="size-3.5" aria-hidden />
                  Your answer
                </span>
              )}
            </button>
          )
        })}
      </div>
      {answered && (
        <div className="mt-2.5 text-[14px] leading-relaxed">
          <p className="font-medium" data-testid="quiz-verdict">
            {verdict(q)}
          </p>
          <div className="mt-1 flex gap-1">
            <span className="shrink-0">Why:</span>
            <div className="min-w-0 flex-1">
              <AnswerText text={q.why} citations={q.citations} onNavigate={onNavigate} />
            </div>
          </div>
          {save}
        </div>
      )}
    </fieldset>
  )
}
