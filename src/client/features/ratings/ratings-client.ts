import { type ChangeResult, post, readChange } from '~/client/lib/post'
import { isStars, type Stars } from '~/shared/ratings/ratings'

export type RatingProblem = 'signed_out' | 'not_found' | 'failed' | 'offline'

export type RatingResult = ChangeResult<Stars | null, RatingProblem>

export function readRatingAnswer(response: Response): Promise<RatingResult> {
  return readChange(response, (body) => (body.stars === null || isStars(body.stars) ? body.stars : undefined), [
    'signed_out',
    'not_found',
  ])
}

export async function setRating(book: string, stars: Stars | null): Promise<RatingResult> {
  let response: Response
  try {
    response = await post('/account/ratings', { book, stars })
  } catch {
    return { ok: false, problem: 'offline' }
  }
  return readRatingAnswer(response)
}
