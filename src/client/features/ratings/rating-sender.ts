import type { Stars } from '~/shared/ratings/ratings'
import type { RatingProblem, RatingResult } from './ratings-client'

export interface RatingSnapshot {
  shown: Stars | null
  saved: Stars | null
  problem: RatingProblem | null
}

export interface RatingSender {
  choose(stars: Stars | null): void
  adopt(stars: Stars | null): void
  snapshot(): RatingSnapshot
}

const NONE = Symbol('none')

export function createRatingSender({
  saved: initial,
  send,
  onChange,
}: {
  saved: Stars | null
  send: (stars: Stars | null) => Promise<RatingResult>
  onChange: (snapshot: RatingSnapshot) => void
}): RatingSender {
  let saved = initial
  let shown = initial
  let problem: RatingProblem | null = null
  let inFlight = false
  let waiting: Stars | null | typeof NONE = NONE

  const snapshot = (): RatingSnapshot => ({ shown, saved, problem })
  const changed = () => onChange(snapshot())

  function start(stars: Stars | null) {
    inFlight = true
    send(stars)
      .catch((): RatingResult => ({ ok: false, problem: 'failed' }))
      .then((result) => {
        inFlight = false
        if (!result.ok) {
          waiting = NONE
          shown = saved
          problem = result.problem
          changed()
          return
        }
        saved = result.value
        problem = null
        const next = waiting
        waiting = NONE
        if (next !== NONE && next !== saved) start(next)
        else shown = saved
        changed()
      })
  }

  return {
    choose(stars) {
      shown = stars
      if (inFlight) waiting = stars
      else if (stars !== saved) start(stars)
      changed()
    },
    adopt(stars) {
      if (inFlight || (stars === saved && stars === shown)) return
      saved = stars
      shown = stars
      changed()
    },
    snapshot,
  }
}
