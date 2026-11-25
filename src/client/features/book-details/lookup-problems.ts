import type { LookupProblem } from './details-client'

export type LookupPanelProblem = LookupProblem | 'cover-too-large' | 'cover-failed'

export const LOOKUP_PROBLEM_TEXT: Record<LookupPanelProblem, string> = {
  rate: 'You’ve looked up 30 times in the last hour. Try again later.',
  busy: 'Open Library is busy. Try again in a moment.',
  unavailable: 'Open Library couldn’t be reached. Try again later.',
  'cover-too-large': 'That cover is too large to use. (The description is still applied.)',
  'cover-failed': 'That cover couldn’t be fetched. (The description is still applied.)',
  not_found: 'This book isn’t on your shelf any more.',
  signed_out: 'You’ve been signed out. Sign in and try again.',
  invalid: 'Enter a title or an ISBN.',
}

export const NO_MATCHES = 'No matches on Open Library. Try fewer words, or the ISBN.'

export function matchesText(count: number): string {
  if (count === 0) return NO_MATCHES
  return count === 1 ? '1 match' : `${count} matches`
}
