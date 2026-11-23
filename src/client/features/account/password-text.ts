const PASSWORD_REASONS = ['short', 'long', 'username'] as const
export type PasswordReason = (typeof PASSWORD_REASONS)[number]

const POLICY_TEXT: Record<PasswordReason, string> = {
  short: 'Use at least 15 characters.',
  long: 'Use at most 256 characters.',
  username: 'Don’t use your username.',
}

export const MISMATCH_TEXT = 'The new passwords don’t match.'

export function newPasswordText(error: 'mismatch' | 'policy', reason: PasswordReason | undefined): string {
  if (error === 'mismatch') return MISMATCH_TEXT
  return reason ? POLICY_TEXT[reason] : 'Choose a different password.'
}

export const parseReason = (value: unknown): PasswordReason | undefined => PASSWORD_REASONS.find((r) => r === value)
