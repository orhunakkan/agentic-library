import { Link } from '@tanstack/react-router'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { Button } from '~/client/features/account/ui'
import type { FlashcardView } from '~/shared/flashcards/contract'
import type { ReviewResult } from '~/shared/flashcards/schedule'
import { nextDueLine } from './dates'
import { REVIEW_PROBLEM } from './flashcard-problems'
import { reviewCard } from './flashcards-client'
import { currentCard, grade, isFinished, progress, type ReviewQueue, startQueue, withoutCard } from './review-queue'

const soonest = (cards: readonly FlashcardView[]) =>
  cards.reduce<string | null>((min, c) => (min === null || c.dueAt < min ? c.dueAt : min), null)

const grades =
  'inline-flex h-12 w-full items-center justify-center rounded-xl border px-4 text-[15px] font-semibold transition disabled:opacity-50'

export function ReviewSession({
  due,
  cards,
  deleted,
  onGraded,
}: {
  due: FlashcardView[]
  cards: FlashcardView[]
  deleted: string[]
  onGraded: (card: FlashcardView) => void
}) {
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])
  const [queue, setQueue] = useState<ReviewQueue | null>(null)
  const [shown, setShown] = useState(false)
  const [sending, setSending] = useState<ReviewResult | null>(null)
  const [failed, setFailed] = useState<ReviewResult | null>(null)
  const front = useRef<HTMLParagraphElement>(null)
  const answer = useRef<HTMLParagraphElement>(null)
  const end = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    setQueue((q) => (q ? deleted.reduce(withoutCard, q) : q))
  }, [deleted])

  const live = due.filter((c) => !deleted.includes(c.id))
  const card = queue ? currentCard(queue) : null
  const finished = queue !== null && isFinished(queue)

  // biome-ignore lint/correctness/useExhaustiveDependencies: moves focus on each change of card, answer or end
  useEffect(() => {
    if (!queue) return
    if (finished) end.current?.focus()
    else if (shown) answer.current?.focus()
    else front.current?.focus()
  }, [queue?.at, shown, finished])

  const send = async (result: ReviewResult) => {
    if (!queue || !card || sending) return
    setSending(result)
    setFailed(null)
    const answered = await reviewCard(card.id, result)
    setSending(null)
    if (!answered.ok) {
      setFailed(result)
      return
    }
    onGraded(answered.value)
    setQueue(grade(queue, result, answered.value))
    setShown(false)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (!card || e.altKey || e.ctrlKey || e.metaKey) return
    const onControl = e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement
    if (e.key === ' ' && !shown && !onControl) {
      e.preventDefault()
      setShown(true)
    } else if (shown && (e.key === '1' || e.key === '2')) {
      e.preventDefault()
      void send(e.key === '1' ? 'again' : 'good')
    }
  }

  let body: React.ReactNode
  if (!hydrated)
    body = (
      <p className="text-[14.5px] text-muted" data-testid="review-needs-js">
        Reviewing needs JavaScript.
      </p>
    )
  else if (finished) {
    body = (
      <div className="space-y-4 text-[14.5px]">
        <p
          ref={end}
          tabIndex={-1}
          className="text-ink outline-none"
          suppressHydrationWarning
          data-testid="review-finished"
        >
          {nextDueLine(soonest(cards), new Date(), true)}
        </p>
        <Link
          to="/account/flashcards"
          data-testid="review-back"
          className="font-medium text-accent underline-offset-2 hover:underline"
        >
          Back to all books
        </Link>
      </div>
    )
  } else if (!queue || !card) {
    body = live.length ? (
      <Button
        type="button"
        data-testid="review-start"
        onClick={() => {
          setQueue(startQueue(live))
          setShown(false)
        }}
      >
        Start review ({live.length.toLocaleString('en-GB')})
      </Button>
    ) : (
      <p className="text-[14.5px] text-muted" suppressHydrationWarning data-testid="review-next-due">
        {nextDueLine(soonest(cards), new Date(), false)}
      </p>
    )
  } else {
    body = (
      <div className="space-y-4">
        <p className="text-[13px] font-medium text-muted" aria-live="polite" data-testid="review-progress">
          {progress(queue)}
        </p>
        <p
          ref={front}
          tabIndex={-1}
          data-testid="review-front"
          className="font-display text-[20px] leading-snug font-semibold text-ink outline-none [overflow-wrap:anywhere]"
        >
          {card.front}
        </p>
        {shown ? (
          <>
            <p
              ref={answer}
              tabIndex={-1}
              data-testid="review-answer"
              className="border-t border-line pt-4 text-[15.5px] leading-relaxed whitespace-pre-line text-ink outline-none [overflow-wrap:anywhere]"
            >
              <span className="sr-only">Answer: </span>
              {card.back}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => void send('again')}
                disabled={sending !== null}
                data-testid="review-again"
                className={`${grades} border-line text-ink hover:bg-panel/60`}
              >
                Again
              </button>
              <button
                type="button"
                onClick={() => void send('good')}
                disabled={sending !== null}
                data-testid="review-good"
                className={`${grades} border-transparent bg-accent-fill text-on-accent hover:brightness-105`}
              >
                Got it
              </button>
            </div>
            {failed && (
              <div
                role="alert"
                data-testid="review-error"
                className="flex flex-wrap items-center gap-3 text-[14px] text-ink"
              >
                <p>{REVIEW_PROBLEM}</p>
                <button
                  type="button"
                  onClick={() => void send(failed)}
                  data-testid="review-retry"
                  className="inline-flex h-10 items-center rounded-full border border-line px-4 text-[13.5px] font-medium hover:bg-panel/60"
                >
                  Retry
                </button>
              </div>
            )}
          </>
        ) : (
          <Button type="button" onClick={() => setShown(true)} data-testid="review-show-answer">
            Show answer
          </Button>
        )}
        <p className="hidden text-[12.5px] text-muted min-[900px]:block">Space shows the answer · 1 Again · 2 Got it</p>
      </div>
    )
  }

  return (
    <section
      aria-labelledby="review-title"
      onKeyDown={onKeyDown}
      className="mt-8 rounded-[22px] border border-line bg-surface p-5 md:p-6"
    >
      <h2 id="review-title" className="mb-4 font-display text-[22px] font-bold tracking-[-0.02em] text-ink">
        Review
      </h2>
      {body}
    </section>
  )
}
