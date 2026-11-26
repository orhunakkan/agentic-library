import type { Provider } from '~/server/api-keys'
import { isOneOf } from '~/shared/lib/json-shape'
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

export const isEmailError = (error: AccountError | undefined): error is EmailError => isOneOf(error, EMAIL_ERROR_CODES)

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
  'openai',
  'rejected',
  'permission',
  'unavailable',
  'limit',
  'invalid',
  'failed',
] as const
export type ApiKeyError = (typeof API_KEY_ERRORS)[number]

const COMMON_KEY_ERRORS: Record<Exclude<ApiKeyError, 'shape' | 'anthropic' | 'openai' | 'permission'>, string> = {
  rejected: 'This key was rejected.',
  unavailable: 'Couldn’t check the key, try again.',
  limit: 'Too many key changes in the last hour. Try again later.',
  invalid: 'That request wasn’t understood. Try again.',
  failed: 'Something went wrong. Try again in a few minutes.',
}

const ELEVENLABS_PERMISSION =
  'This key can’t read your voices. In ElevenLabs, allow it Voices (read) and Text to Speech.'

const ANTHROPIC_SHAPE = 'That doesn’t look like an Anthropic API key. Keys start with sk-ant- and have no spaces.'
const IN_ANTHROPIC = 'That’s an Anthropic key. Paste it in the Anthropic section above.'

/** Each section's own sentences; anything not here is said the same way everywhere. */
const PROVIDER_KEY_ERRORS: Record<Provider, Partial<Record<ApiKeyError, string>>> = {
  anthropic: {
    shape: ANTHROPIC_SHAPE,
    anthropic: ANTHROPIC_SHAPE,
    openai: 'That’s an OpenAI key. Paste it in the OpenAI section below.',
  },
  openai: {
    shape: 'That doesn’t look like an OpenAI API key. Keys start with sk- and have no spaces.',
    anthropic: IN_ANTHROPIC,
    openai: 'That doesn’t look like an OpenAI API key. Keys start with sk- and have no spaces.',
  },
  elevenlabs: {
    shape: 'That doesn’t look like an ElevenLabs API key.',
    anthropic: IN_ANTHROPIC,
    openai: 'That doesn’t look like an ElevenLabs API key.',
    permission: ELEVENLABS_PERMISSION,
  },
}

export function apiKeyErrorText(error: ApiKeyError, provider: Provider | undefined): string {
  const own = PROVIDER_KEY_ERRORS[provider ?? 'anthropic'][error]
  if (own) return own
  return error === 'permission'
    ? COMMON_KEY_ERRORS.rejected
    : COMMON_KEY_ERRORS[error as keyof typeof COMMON_KEY_ERRORS]
}

export const API_KEY_STATUS_TEXT: Record<ApiKeyStatus, string> = {
  saved: 'Key saved.',
  deleted: 'Key deleted.',
  'model-saved': 'Model saved.',
  'speech-model-saved': 'Voice model saved.',
}
