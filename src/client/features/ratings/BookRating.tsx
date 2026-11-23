import { Link, useRouterState } from '@tanstack/react-router'
import { Star } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
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
  const here = useRouterState({ select: (s) => s.location.href })

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
            {STAR_VALUES.map((n) => (
              <label
                key={n}
                title={starLabel(n)}
                onPointerEnter={(e) => e.pointerType === 'mouse' && setHovered(n)}
                className="relative grid size-11 cursor-pointer place-items-center rounded-lg has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent"
              >
                <input
                  ref={n === 1 ? firstStar : undefined}
                  type="radio"
                  name={`rating-${slug}`}
                  value={n}
                  checked={shown === n}
                  onChange={() => sender.current?.choose(n)}
                  data-testid="book-rating-star"
                  data-key={n}
                  className="sr-only"
                />
                <Star
                  aria-hidden
                  className={cn('size-6 transition', n <= lit ? 'text-accent' : 'text-subtle')}
                  fill={n <= lit ? 'currentColor' : 'none'}
                />
                <span className="sr-only">{starLabel(n)}</span>
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
          {problem === 'signed_out' && (
            <>
              {' '}
              <Link
                to="/login"
                search={{ next: here }}
                className="font-semibold underline underline-offset-4"
                data-testid="book-rating-sign-in"
              >
                Sign in
              </Link>
            </>
          )}
        </p>
      )}
    </div>
  )
}
