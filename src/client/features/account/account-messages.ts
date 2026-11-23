import type { Provider } from '~/server/api-keys'
import { DELETE_BILLING_FAILED } from '~/shared/billing/copy'
import { proNotice } from '~/shared/plans/copy'
import { newPasswordText, type PasswordReason } from './password-text'

export const ACCOUNT_STATUSES = [
  'password-changed',
  'signed-out-others',
  'email-sent',
  'email-confirmed',
  'email-removed',
  'passkey-removed',
  'token-revoked',
  'welcome',
] as const
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number]

export const EMAIL_ERROR_CODES = [
  'email-invalid',
  'email-current',
  'email-same',
  'email-limit',
  'email-busy',
  'email-failed',
] as const
export type EmailError = (typeof EMAIL_ERROR_CODES)[number]

export const ACCOUNT_ERRORS = [
  'mismatch',
  'policy',
  'current',
  'delete-current',
  'last-admin',
  'delete-billing',
  'invalid',
  'unavailable',
  ...EMAIL_ERROR_CODES,
] as const
export type AccountError = (typeof ACCOUNT_ERRORS)[number]

export const ACCOUNT_STATUS_TEXT: Record<Exclude<AccountStatus, 'welcome' | 'token-revoked'>, string> = {
  'password-changed': 'Password changed. Every other session has been signed out.',
  'signed-out-others': 'Every other session has been signed out.',
  'email-sent': 'Check your inbox: the confirmation link works for 24 hours.',
  'email-confirmed': 'Your email address is confirmed.',
  'email-removed': 'Your email address has been removed.',
  'passkey-removed': 'Passkey removed.',
}

export const EMAIL_ERRORS: Record<EmailError, string> = {
  'email-invalid': 'Enter an email address like name@example.com.',
  'email-current': 'Your password is incorrect.',
  'email-same': 'That’s already your confirmed address.',
  'email-limit': 'You’ve asked for 5 links in the last hour. Try again later.',
  'email-busy': 'Folio can’t send more mail right now. Try again later.',
  'email-failed': 'The email couldn’t be sent. Try again in a few minutes.',
}

export const isEmailError = (error: AccountError | undefined): error is EmailError =>
  (EMAIL_ERROR_CODES as readonly string[]).includes(error ?? '')

export function accountErrorText(error: AccountError, reason: PasswordReason | undefined): string {
  if (isEmailError(error)) return EMAIL_ERRORS[error]
  switch (error) {
    case 'mismatch':
    case 'policy':
      return newPasswordText(error, reason)
    case 'current':
      return 'Your current password is incorrect.'
    case 'delete-current':
      return 'Your password is incorrect.'
    case 'last-admin':
      return 'You’re the only admin. Make someone else an admin on the Users page first.'
    case 'delete-billing':
      return DELETE_BILLING_FAILED
    case 'invalid':
      return 'That request wasn’t understood. Try again.'
    case 'unavailable':
      return 'Something went wrong. Try again in a few minutes.'
  }
}

export const API_KEY_STATUSES = ['saved', 'deleted', 'model-saved', 'speech-model-saved'] as const
export type ApiKeyStatus = (typeof API_KEY_STATUSES)[number]

export const API_KEY_ERRORS = [
  'shape',
  'anthropic',
  'rejected',
  'permission',
  'unavailable',
  'limit',
  'invalid',
  'failed',
  'pro',
] as const
export type ApiKeyError = (typeof API_KEY_ERRORS)[number]

const COMMON_KEY_ERRORS: Record<Exclude<ApiKeyError, 'shape' | 'anthropic' | 'permission'>, string> = {
  rejected: 'This key was rejected.',
  unavailable: 'Couldn’t check the key, try again.',
  limit: 'Too many key changes in the last hour. Try again later.',
  invalid: 'That request wasn’t understood. Try again.',
  failed: 'Something went wrong. Try again in a few minutes.',
  pro: proNotice('elevenlabs').heading,
}

const ELEVENLABS_PERMISSION =
  'This key can’t read your voices. In ElevenLabs, allow it Voices (read) and Text to Speech.'

export function apiKeyErrorText(error: ApiKeyError, provider: Provider | undefined): string {
  if (provider === 'elevenlabs') {
    if (error === 'shape') return 'That doesn’t look like an ElevenLabs API key.'
    if (error === 'anthropic') return 'That’s an Anthropic key. Paste it in the Anthropic section above.'
    if (error === 'permission') return ELEVENLABS_PERMISSION
  } else if (error === 'shape' || error === 'anthropic') {
    return 'That doesn’t look like an Anthropic API key. Keys start with sk-ant- and have no spaces.'
  }
  return error === 'permission' ? COMMON_KEY_ERRORS.rejected : COMMON_KEY_ERRORS[error]
}

export const API_KEY_STATUS_TEXT: Record<ApiKeyStatus, string> = {
  saved: 'Key saved.',
  deleted: 'Key deleted.',
  'model-saved': 'Model saved.',
  'speech-model-saved': 'Voice model saved.',
}
