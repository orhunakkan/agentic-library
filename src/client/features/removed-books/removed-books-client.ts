import { type ChangeResult, post, readChange } from '~/client/lib/post'

export type RemovedBookProblem = 'signed_out' | 'not_found' | 'failed' | 'offline'

export type RemovedBookResult = ChangeResult<boolean, RemovedBookProblem>

export function readRemovedAnswer(response: Response): Promise<RemovedBookResult> {
  return readChange(response, (body) => (typeof body.removed === 'boolean' ? body.removed : undefined), [
    'signed_out',
    'not_found',
  ])
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
