import type { SignupFinishError, SignupRequestError } from '~/shared/signup/signup'
import { newPasswordText, type PasswordReason } from './password-text'

export const SIGNUP_SENT_TEXT =
  'Check your inbox. If the address can receive mail, a link to finish signing up is on its way. It works for 24 hours.'

export const SIGNUP_CLOSED_TEXT = 'Sign-up is closed on this server. Accounts are created by the site’s owner.'
export const SIGNUP_UNAVAILABLE_TEXT = 'Sign-up isn’t working right now. Try again in a few minutes.'
export const SIGNUP_LINK_INVALID_TEXT = 'This link has expired or was already used.'

const REQUEST_ERRORS: Record<SignupRequestError, string> = {
  invalid: 'Enter an email address, like name@example.com.',
  limited: 'Too many sign-up requests from this network. Try again in an hour.',
  busy: 'Sign-up is busy today. Try again tomorrow.',
  unavailable: SIGNUP_UNAVAILABLE_TEXT,
}

export const requestErrorText = (error: SignupRequestError): string => REQUEST_ERRORS[error]

export function finishErrorText(error: SignupFinishError, reason: PasswordReason | undefined): string {
  switch (error) {
    case 'username':
      return 'Usernames are 3 to 32 characters: lowercase letters, digits, - and _, starting with a letter or digit.'
    case 'taken':
      return 'That username isn’t available. Try another.'
    case 'policy':
    case 'mismatch':
      return newPasswordText(error, reason)
    case 'unavailable':
      return SIGNUP_UNAVAILABLE_TEXT
  }
}
