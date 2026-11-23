export const SIGNUP_MODES = ['off', 'invite', 'open'] as const
export type SignupMode = (typeof SIGNUP_MODES)[number]

export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_-]{2,31}$/

export const RESERVED_SIGNUP_NAMES: readonly string[] = [
  'new',
  'invites',
  'admin',
  'administrator',
  'root',
  'owner',
  'folio',
  'support',
  'help',
  'system',
  'security',
  'postmaster',
  'abuse',
  'noreply',
  'no-reply',
]

export const isReservedSignupName = (username: string) => RESERVED_SIGNUP_NAMES.includes(username)

export interface SignInFooter {
  text: string
  link?: { label: string; href: '/signup' }
}

export function signInFooter(mode: SignupMode, mail: boolean): SignInFooter {
  switch (mode) {
    case 'open':
      return { text: 'New to Folio?', link: { label: 'Create an account', href: '/signup' } }
    case 'invite':
      return {
        text: mail
          ? 'Accounts are by invitation: the site’s owner sends you a link to create one.'
          : 'Accounts are by invitation: the site’s owner sends you a link to create one. The owner also resets ' +
            'forgotten passwords.',
      }
    case 'off':
      return {
        text: mail
          ? 'Accounts are created by the site’s owner. There is no sign-up.'
          : 'Accounts are created by the site’s owner. There is no sign-up, and the owner resets forgotten passwords.',
      }
  }
}

export const SIGNUP_REQUEST_ERRORS = ['invalid', 'limited', 'busy', 'unavailable'] as const
export type SignupRequestError = (typeof SIGNUP_REQUEST_ERRORS)[number]

export const SIGNUP_FINISH_ERRORS = ['username', 'taken', 'policy', 'mismatch', 'unavailable'] as const
export type SignupFinishError = (typeof SIGNUP_FINISH_ERRORS)[number]

export const SIGNUP_ERRORS: readonly (SignupRequestError | SignupFinishError)[] = [
  ...SIGNUP_REQUEST_ERRORS,
  ...SIGNUP_FINISH_ERRORS.filter((e) => e !== 'unavailable'),
]

export const SIGNUP_LINK_HOURS = 24
export const INVITE_DAYS = 7

export const MAX_SIGNUP_ATTEMPTS = 10

export const INVITE_MAX = 20
