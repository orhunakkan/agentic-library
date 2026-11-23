import { createFileRoute, Link } from '@tanstack/react-router'
import { AccountPage, Button, Notice, TextField } from '~/client/features/account/ui'
import { getSignInAvailable } from '~/server/account-functions'
import { handleForgotPassword } from '~/server/email/actions'
import { SITE_NAME } from '~/shared/lib/site'

interface ForgotSearch {
  status?: 'sent'
  error?: 'invalid' | 'limited' | 'unavailable'
}

const ERRORS = ['invalid', 'limited', 'unavailable'] as const

const MESSAGES = {
  invalid: 'Enter your username or email address.',
  limited: 'Too many reset requests from this network. Try again in an hour.',
  unavailable: 'Password reset isn’t working right now. Try again in a few minutes.',
}

export const Route = createFileRoute('/forgot-password')({
  validateSearch: (search: Record<string, unknown>): ForgotSearch => ({
    status: search.status === 'sent' ? 'sent' : undefined,
    error: ERRORS.find((e) => e === search.error),
  }),
  loader: () => getSignInAvailable(),
  head: () => ({ meta: [{ title: `Reset your password | ${SITE_NAME}` }, { name: 'robots', content: 'noindex' }] }),
  server: { handlers: { POST: ({ request }) => handleForgotPassword(request) } },
  component: ForgotPasswordPage,
})

function ForgotPasswordPage() {
  const { mail } = Route.useLoaderData()
  const { status, error } = Route.useSearch()
  const errorId = error ? 'forgot-error' : undefined
  if (!mail)
    return (
      <AccountPage eyebrow="Account" title="Reset your password" titleTestId="forgot-password-title">
        <Notice kind="error" data-testid="forgot-password-off">
          Password reset by email isn’t set up on this server. Ask the site’s owner to reset your password.
        </Notice>
        <BackToSignIn />
      </AccountPage>
    )
  return (
    <AccountPage
      eyebrow="Account"
      title="Reset your password"
      titleTestId="forgot-password-title"
      lead="Enter your username or your account’s email address. If the account has a confirmed address, we’ll send it a link to choose a new password."
    >
      {status === 'sent' && (
        <Notice kind="success" data-testid="forgot-password-sent">
          If that account has a confirmed email address, a link is on its way. It works once, for 30 minutes. Check your
          spam folder if it doesn’t arrive.
        </Notice>
      )}
      {error && (
        <Notice kind="error" id={errorId} data-testid="forgot-password-error">
          {MESSAGES[error]}
        </Notice>
      )}
      <form method="post" action="/forgot-password" className="mt-8 max-w-[420px] space-y-5">
        <TextField
          label="Username or email address"
          name="identifier"
          data-testid="forgot-password-identifier"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          maxLength={254}
          aria-invalid={error === 'invalid' || undefined}
          aria-describedby={errorId}
        />
        <Button data-testid="forgot-password-send">Send reset link</Button>
      </form>
      <BackToSignIn />
    </AccountPage>
  )
}

function BackToSignIn() {
  return (
    <p className="mt-8 text-[15px]">
      <Link
        to="/login"
        data-testid="forgot-password-back"
        className="font-medium text-accent underline-offset-2 hover:underline"
      >
        Back to sign in
      </Link>
    </p>
  )
}
