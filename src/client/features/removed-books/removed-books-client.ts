import { type ChangeResult, post } from '~/client/features/highlights/highlights-client'

export type RemovedBookProblem = 'signed_out' | 'not_found' | 'failed' | 'offline'

export type RemovedBookResult = ChangeResult<boolean, RemovedBookProblem>

export async function readRemovedAnswer(response: Response): Promise<RemovedBookResult> {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (response.ok) {
    return typeof body.removed === 'boolean' ? { ok: true, value: body.removed } : { ok: false, problem: 'failed' }
  }
  if (body.error === 'signed_out' || body.error === 'not_found') return { ok: false, problem: body.error }
  return { ok: false, problem: 'failed' }
}

export async function setRemoved(book: string, removed: boolean): Promise<RemovedBookResult> {
  let response: Response
  try {
    response = await post('/account/removed-books', { book, removed })
  } catch {
    return { ok: false, problem: 'offline' }
  }
  return readRemovedAnswer(response)
}

export function problemText(problem: RemovedBookProblem): string {
  switch (problem) {
    case 'signed_out':
      return 'Your session ended.'
    case 'not_found':
      return 'This book is no longer available.'
    default:
      return 'Couldn’t save that. Try again.'
  }
}
