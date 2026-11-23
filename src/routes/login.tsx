import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useEffect } from 'react'
import { clearBrowserAccountData } from '~/client/features/account/sign-out'
import { AccountPage, Button, Notice, TextField } from '~/client/features/account/ui'
import { browserStorage } from '~/client/features/ask/thread-store'
import { forgetPrivateDownloads } from '~/client/features/offline/store'
import { PasskeySignIn } from '~/client/features/passkeys/PasskeySignIn'
import { UNAVAILABLE_TEXT } from '~/client/features/passkeys/passkey-problems'
import { handleLogin } from '~/server/account-actions'
import { getSignInAvailable } from '~/server/account-functions'
import { DEFAULT_AFTER_SIGN_IN, safeNext } from '~/shared/lib/safe-next'
import { SITE_NAME } from '~/shared/lib/site'
import { signInFooter } from '~/shared/signup/signup'

interface LoginSearch {
  next?: string
  error?: 'invalid' | 'unavailable'
  status?: 'account-deleted' | 'password-reset'
}

const STATUSES = ['account-deleted', 'password-reset'] as const

const ERRORS = ['invalid', 'unavailable'] as const

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    next: typeof search.next === 'string' && search.next !== DEFAULT_AFTER_SIGN_IN ? search.next : undefined,
    error: ERRORS.find((e) => e === search.error),
    status: STATUSES.find((s) => s === search.status),
  }),
  beforeLoad: ({ context, search }) => {
    if (context.viewer) throw redirect({ href: safeNext(search.next) })
  },
  loader: () => getSignInAvailable(),
  head: () => ({ meta: [{ title: `Sign in | ${SITE_NAME}` }, { name: 'robots', content: 'noindex' }] }),
  server: { handlers: { POST: ({ request }) => handleLogin(request) } },
  component: LoginPage,
})

const MESSAGES = {
  invalid: 'Username or password is incorrect.',
  unavailable: UNAVAILABLE_TEXT,
}

function LoginPage() {
  const { signIn: available, mail, signup } = Route.useLoaderData()
  const footer = signInFooter(signup, mail)
  const { next, error, status } = Route.useSearch()
  const errorId = error ? 'login-error' : undefined
  const deleted = status === 'account-deleted'
  useEffect(() => {
    if (!deleted) return
    clearBrowserAccountData(browserStorage())
    void forgetPrivateDownloads().catch(() => {})
  }, [deleted])
  return (
    <AccountPage
      eyebrow="Account"
      title="Sign in"
      titleTestId="sign-in-title"
      lead="Reading and listening need no account. Signing in opens your account settings and API keys."
    >
      {!available && (
        <Notice kind="error" data-testid="sign-in-unavailable">
          The database isn’t configured on this server, so signing in isn’t available.
        </Notice>
      )}
      {deleted && (
        <Notice kind="success" data-testid="sign-in-account-deleted">
          Your account and everything in it have been deleted.
        </Notice>
      )}
      {status === 'password-reset' && (
        <Notice kind="success" data-testid="sign-in-password-reset">
          Your password has been changed and every session signed out. Sign in with the new one.
        </Notice>
      )}
      {error && (
        <Notice kind="error" id={errorId} data-testid="sign-in-error">
          {MESSAGES[error]}
        </Notice>
      )}
      <form method="post" action="/login" className="mt-8 max-w-[420px] space-y-5">
        <input type="hidden" name="next" value={next ?? ''} />
        <TextField
          label="Username"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          maxLength={64}
          aria-invalid={error === 'invalid' || undefined}
          aria-describedby={errorId}
        />
        <TextField
          label="Password"
          name="password"
          type="password"
          data-testid="password"
          autoComplete="current-password"
          required
          maxLength={1024}
          aria-invalid={error === 'invalid' || undefined}
          aria-describedby={errorId}
        />
        {mail && (
          <p className="-mt-2 text-[14px]">
            <Link
              to="/forgot-password"
              data-testid="sign-in-forgot-password"
              className="font-medium text-accent underline-offset-2 hover:underline"
            >
              Forgot your password?
            </Link>
          </p>
        )}
        <Button data-testid="sign-in">Sign in</Button>
      </form>
      {available && <PasskeySignIn next={next} />}
      <p className="mt-8 text-[14px] text-muted">
        {footer.text}
        {footer.link && (
          <>
            {' '}
            <Link
              to={footer.link.href}
              data-testid="sign-in-sign-up-link"
              className="font-semibold text-accent underline-offset-2 hover:underline"
            >
              {footer.link.label}
            </Link>
          </>
        )}
      </p>
    </AccountPage>
  )
}
