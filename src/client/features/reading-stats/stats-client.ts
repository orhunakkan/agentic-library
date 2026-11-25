import { type ChangeResult, post, readChange } from '~/client/lib/post'
import type { FinishedErrorCode, GoalErrorCode } from '~/shared/reading-stats/contract'

export type GoalProblem = GoalErrorCode
export type FinishedProblem = FinishedErrorCode

export interface SavedGoal {
  minutes: number
  fromDay: string
}

export interface FinishedAnswer {
  book: string
  finished: boolean
  added: boolean
}

async function send<T, P extends string>(
  path: string,
  body: unknown,
  pick: (body: Record<string, unknown>) => T | undefined,
  codes: readonly P[],
): Promise<ChangeResult<T, P | 'failed'>> {
  try {
    return await readChange(await post(path, body), pick, codes)
  } catch {
    return { ok: false, problem: 'failed' }
  }
}

const goalOf = (body: Record<string, unknown>): SavedGoal | undefined => {
  const goal = body.goal as Record<string, unknown> | undefined
  return goal && typeof goal.minutes === 'number' && typeof goal.fromDay === 'string'
    ? { minutes: goal.minutes, fromDay: goal.fromDay }
    : undefined
}

const finishedOf = (body: Record<string, unknown>): FinishedAnswer | undefined =>
  typeof body.book === 'string' && typeof body.finished === 'boolean' && typeof body.added === 'boolean'
    ? { book: body.book, finished: body.finished, added: body.added }
    : undefined

export function saveGoal(minutes: number, zone: string): Promise<ChangeResult<SavedGoal, GoalProblem>> {
  return send('/account/stats/goal', { minutes, zone }, goalOf, ['invalid', 'signed_out', 'failed'])
}

export function setFinished(book: string, finished: boolean): Promise<ChangeResult<FinishedAnswer, FinishedProblem>> {
  return send('/account/stats/finished', { book, finished }, finishedOf, [
    'invalid',
    'signed_out',
    'not_found',
    'failed',
  ])
}
