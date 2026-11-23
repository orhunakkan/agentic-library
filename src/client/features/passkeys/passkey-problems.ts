import { MAX_PASSKEYS } from '~/shared/passkeys/passkeys'
import { EMAIL_ERRORS } from '../account/account-messages'
import type { AddProblem, Problem, SignInProblem } from './passkeys-client'

export const NETWORK_TEXT = 'Couldn’t reach Folio. Check your connection and try again.'
export const QUOTA_TEXT = `You have ${MAX_PASSKEYS} passkeys, the most an account can have. Remove one to add another.`

export const UNAVAILABLE_TEXT = 'Signing in isn’t working right now. Try again in a few minutes.'

const cancelled = (name: string) => name === 'NotAllowedError' || name === 'AbortError'

const ADD_TEXT: Record<AddProblem, string> = {
  password: EMAIL_ERRORS['email-current'],
  quota: QUOTA_TEXT,
  expired: 'That took too long. Try again.',
  taken: 'This passkey is already set up for a Folio account.',
  refused: 'Folio couldn’t check that passkey. Try again.',
  invalid: 'Folio couldn’t check that passkey. Try again.',
  failed: 'Folio couldn’t check that passkey. Try again.',
  network: NETWORK_TEXT,
  signed_out: 'You’ve been signed out. Sign in again to add a passkey.',
}

export function addProblemText(problem: Problem<AddProblem>): string | null {
  if (problem.kind === 'server') return ADD_TEXT[problem.code]
  if (cancelled(problem.name)) return null
  if (problem.name === 'InvalidStateError') return 'This device already has a passkey for your account.'
  return ADD_TEXT.refused
}

const SIGN_IN_TEXT: Record<SignInProblem, string> = {
  refused: 'That passkey didn’t work. Try again, or sign in with your password.',
  invalid: 'That passkey didn’t work. Try again, or sign in with your password.',
  limited: 'Too many sign-in attempts from this network. Try again in 15 minutes.',
  unavailable: UNAVAILABLE_TEXT,
  network: NETWORK_TEXT,
}

export function signInProblemText(problem: Problem<SignInProblem>): string | null {
  if (problem.kind === 'server') return SIGN_IN_TEXT[problem.code]
  if (cancelled(problem.name)) return null
  return SIGN_IN_TEXT.refused
}
