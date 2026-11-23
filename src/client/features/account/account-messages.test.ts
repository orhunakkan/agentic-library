import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_ERRORS,
  ACCOUNT_STATUS_TEXT,
  API_KEY_ERRORS,
  API_KEY_STATUS_TEXT,
  accountErrorText,
  apiKeyErrorText,
  EMAIL_ERROR_CODES,
  isEmailError,
} from './account-messages'

describe('/account messages', () => {
  it('has a sentence for every status but welcome, which has its own notice', () => {
    expect(ACCOUNT_STATUS_TEXT).toEqual({
      'password-changed': 'Password changed. Every other session has been signed out.',
      'signed-out-others': 'Every other session has been signed out.',
      'email-sent': 'Check your inbox: the confirmation link works for 24 hours.',
      'email-confirmed': 'Your email address is confirmed.',
      'email-removed': 'Your email address has been removed.',
      'passkey-removed': 'Passkey removed.',
    })
  })

  it('has a sentence for every error', () => {
    expect(Object.fromEntries(ACCOUNT_ERRORS.map((e) => [e, accountErrorText(e, undefined)]))).toEqual({
      mismatch: 'The new passwords don’t match.',
      policy: 'Choose a different password.',
      current: 'Your current password is incorrect.',
      'delete-current': 'Your password is incorrect.',
      'last-admin': 'You’re the only admin. Make someone else an admin on the Users page first.',
      'delete-billing':
        'Couldn’t cancel your Pro subscription, so your account wasn’t deleted. Try again, or cancel it in Manage billing first.',
      invalid: 'That request wasn’t understood. Try again.',
      unavailable: 'Something went wrong. Try again in a few minutes.',
      'email-invalid': 'Enter an email address like name@example.com.',
      'email-current': 'Your password is incorrect.',
      'email-same': 'That’s already your confirmed address.',
      'email-limit': 'You’ve asked for 5 links in the last hour. Try again later.',
      'email-busy': 'Folio can’t send more mail right now. Try again later.',
      'email-failed': 'The email couldn’t be sent. Try again in a few minutes.',
    })
  })

  it('says why a new password was refused', () => {
    expect(accountErrorText('policy', 'short')).toBe('Use at least 15 characters.')
  })

  it('tells the Email section’s errors from the rest', () => {
    expect(ACCOUNT_ERRORS.filter(isEmailError)).toEqual([...EMAIL_ERROR_CODES])
    expect(isEmailError(undefined)).toBe(false)
  })
})

describe('/account/api-keys messages', () => {
  it('has a sentence for every status', () => {
    expect(API_KEY_STATUS_TEXT).toEqual({
      saved: 'Key saved.',
      deleted: 'Key deleted.',
      'model-saved': 'Model saved.',
      'speech-model-saved': 'Voice model saved.',
    })
  })

  it('has a sentence for every error in the Anthropic section, and at the top', () => {
    const anthropic = {
      shape: 'That doesn’t look like an Anthropic API key. Keys start with sk-ant- and have no spaces.',
      anthropic: 'That doesn’t look like an Anthropic API key. Keys start with sk-ant- and have no spaces.',
      rejected: 'This key was rejected.',
      permission: 'This key was rejected.',
      unavailable: 'Couldn’t check the key, try again.',
      limit: 'Too many key changes in the last hour. Try again later.',
      invalid: 'That request wasn’t understood. Try again.',
      failed: 'Something went wrong. Try again in a few minutes.',
      pro: 'ElevenLabs voices are part of Pro.',
    }
    expect(Object.fromEntries(API_KEY_ERRORS.map((e) => [e, apiKeyErrorText(e, 'anthropic')]))).toEqual(anthropic)
    expect(Object.fromEntries(API_KEY_ERRORS.map((e) => [e, apiKeyErrorText(e, undefined)]))).toEqual(anthropic)
  })

  it('has a sentence for every error in the ElevenLabs section', () => {
    expect(Object.fromEntries(API_KEY_ERRORS.map((e) => [e, apiKeyErrorText(e, 'elevenlabs')]))).toEqual({
      shape: 'That doesn’t look like an ElevenLabs API key.',
      anthropic: 'That’s an Anthropic key. Paste it in the Anthropic section above.',
      rejected: 'This key was rejected.',
      permission: 'This key can’t read your voices. In ElevenLabs, allow it Voices (read) and Text to Speech.',
      unavailable: 'Couldn’t check the key, try again.',
      limit: 'Too many key changes in the last hour. Try again later.',
      invalid: 'That request wasn’t understood. Try again.',
      failed: 'Something went wrong. Try again in a few minutes.',
      pro: 'ElevenLabs voices are part of Pro.',
    })
  })
})
