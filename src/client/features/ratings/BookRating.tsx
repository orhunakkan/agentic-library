import { Star } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { SignInAgain } from '~/client/components/SignInAgain'
import { cn } from '~/client/lib/cn'
import { type RatingState, STAR_VALUES, type Stars } from '~/shared/ratings/ratings'
import { createRatingSender, type RatingSender, type RatingSnapshot } from './rating-sender'
import { CLEAR_RATING, problemText, RATING_LEGEND, RATING_UNAVAILABLE, ratingValue, starLabel } from './rating-text'
import { setRating } from './ratings-client'

export function BookRating({ slug, rating }: { slug: string; rating: RatingState }) {
  if (rating.state === 'hidden') return null
  if (rating.state === 'unavailable')
    return (
      <p className="mt-5 text-[13.5px] text-muted" data-testid="book-rating-unavailable">
        {RATING_UNAVAILABLE}
      </p>
    )
  return <RatingControl key={slug} slug={slug} saved={rating.stars} />
}

function RatingControl({ slug, saved }: { slug: string; saved: Stars | null }) {
  const [snapshot, setSnapshot] = useState<RatingSnapshot>({ shown: saved, saved, problem: null })
  const sender = useRef<RatingSender | null>(null)
  if (!sender.current)
    sender.current = createRatingSender({ saved, send: (s) => setRating(slug, s), onChange: setSnapshot })
  const [hovered, setHovered] = useState<Stars | null>(null)
  const firstStar = useRef<HTMLInputElement>(null)

  useEffect(() => sender.current?.adopt(saved), [saved])

  const { shown, problem } = snapshot
  const lit = hovered ?? shown ?? 0

  function clear() {
    sender.current?.choose(null)
    firstStar.current?.focus()
  }

  return (
    <div className="mt-5">
      <fieldset data-testid="book-rating" className="min-w-0">
        <legend className="sr-only">{RATING_LEGEND}</legend>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span aria-hidden className="text-[13.5px] text-muted">
            {RATING_LEGEND}
          </span>
          <div className="flex" onPointerLeave={() => setHovered(null)}>
            {STAR_VALUES.map((stars) => (
              <label
                key={stars}
                title={starLabel(stars)}
                onPointerEnter={(e) => e.pointerType === 'mouse' && setHovered(stars)}
                className="relative grid size-11 cursor-pointer place-items-center rounded-lg has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent"
              >
                <input
                  ref={stars === 1 ? firstStar : undefined}
                  type="radio"
                  name={`rating-${slug}`}
                  value={stars}
                  checked={shown === stars}
                  onChange={() => sender.current?.choose(stars)}
                  data-testid="book-rating-star"
                  data-key={stars}
                  className="sr-only"
                />
                <Star
                  aria-hidden
                  className={cn('size-6 transition', stars <= lit ? 'text-accent' : 'text-subtle')}
                  fill={stars <= lit ? 'currentColor' : 'none'}
                />
                <span className="sr-only">{starLabel(stars)}</span>
              </label>
            ))}
          </div>
          <span className="text-[14px] text-ink" data-testid="book-rating-value">
            {ratingValue(shown)}
          </span>
          {shown !== null && (
            <button
              type="button"
              onClick={clear}
              data-testid="book-rating-clear"
              className="ml-1 min-h-11 px-1 text-[14px] font-semibold text-muted underline decoration-line underline-offset-4 transition hover:text-ink hover:decoration-accent"
            >
              {CLEAR_RATING}
            </button>
          )}
        </div>
      </fieldset>
      {problem && (
        <p role="alert" data-testid="book-rating-error" className="mt-1 text-[14px] text-red-700 dark:text-red-300">
          {problemText(problem)}
          {problem === 'signed_out' && <SignInAgain testId="book-rating-sign-in" />}
        </p>
      )}
    </div>
  )
}
