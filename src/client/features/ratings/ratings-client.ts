import { type ChangeResult, post } from '~/client/features/highlights/highlights-client'
import { isStars, type Stars } from '~/shared/ratings/ratings'

export type RatingProblem = 'signed_out' | 'not_found' | 'failed' | 'offline'

export type RatingResult = ChangeResult<Stars | null, RatingProblem>

export async function readRatingAnswer(response: Response): Promise<RatingResult> {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (response.ok) {
    return body.stars === null || isStars(body.stars)
      ? { ok: true, value: body.stars }
      : { ok: false, problem: 'failed' }
  }
  if (body.error === 'signed_out' || body.error === 'not_found') return { ok: false, problem: body.error }
  return { ok: false, problem: 'failed' }
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
