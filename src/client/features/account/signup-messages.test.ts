import { describe, expect, it } from 'vitest'
import { SIGNUP_FINISH_ERRORS, SIGNUP_REQUEST_ERRORS } from '~/shared/signup/signup'
import {
  finishErrorText,
  requestErrorText,
  SIGNUP_CLOSED_TEXT,
  SIGNUP_LINK_INVALID_TEXT,
  SIGNUP_SENT_TEXT,
  SIGNUP_UNAVAILABLE_TEXT,
} from './signup-messages'

describe('signup messages', () => {
  it('says what happens after asking for a link, and why a page offers no form', () => {
    expect(SIGNUP_SENT_TEXT).toBe(
      'Check your inbox. If the address can receive mail, a link to finish signing up is on its way. It works for 24 hours.',
    )
    expect(SIGNUP_CLOSED_TEXT).toBe('Sign-up is closed on this server. Accounts are created by the site’s owner.')
    expect(SIGNUP_UNAVAILABLE_TEXT).toBe('Sign-up isn’t working right now. Try again in a few minutes.')
    expect(SIGNUP_LINK_INVALID_TEXT).toBe('This link has expired or was already used.')
  })

  it('has a sentence for every refused request for a link', () => {
    expect(Object.fromEntries(SIGNUP_REQUEST_ERRORS.map((e) => [e, requestErrorText(e)]))).toEqual({
      invalid: 'Enter an email address, like name@example.com.',
      limited: 'Too many sign-up requests from this network. Try again in an hour.',
      busy: 'Sign-up is busy today. Try again tomorrow.',
      unavailable: 'Sign-up isn’t working right now. Try again in a few minutes.',
    })
  })

  it('has a sentence for every refused username and password', () => {
    expect(Object.fromEntries(SIGNUP_FINISH_ERRORS.map((e) => [e, finishErrorText(e, undefined)]))).toEqual({
      username:
        'Usernames are 3 to 32 characters: lowercase letters, digits, - and _, starting with a letter or digit.',
      taken: 'That username isn’t available. Try another.',
      policy: 'Choose a different password.',
      mismatch: 'The new passwords don’t match.',
      unavailable: 'Sign-up isn’t working right now. Try again in a few minutes.',
    })
  })

  it('says why a password was refused, as the account page does', () => {
    expect(finishErrorText('policy', 'short')).toBe('Use at least 15 characters.')
    expect(finishErrorText('policy', 'long')).toBe('Use at most 256 characters.')
    expect(finishErrorText('policy', 'username')).toBe('Don’t use your username.')
  })
})
