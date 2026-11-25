import { createFileRoute, Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { type PasswordReason, parseReason } from '~/client/features/account/password-text'
import {
  finishErrorText,
  requestErrorText,
  SIGNUP_CLOSED_TEXT,
  SIGNUP_LINK_INVALID_TEXT,
  SIGNUP_SENT_TEXT,
  SIGNUP_UNAVAILABLE_TEXT,
} from '~/client/features/account/signup-messages'
import { AccountPage, Button, Notice, TextField } from '~/client/features/account/ui'
import { getSignInAvailable, getSignupPage } from '~/server/account-functions'
import { handleSignup } from '~/server/signup/actions'
import { isOneOf } from '~/shared/lib/json-shape'
import { SITE_NAME } from '~/shared/lib/site'
import {
  SIGNUP_ERRORS,
  SIGNUP_FINISH_ERRORS,
  SIGNUP_REQUEST_ERRORS,
  type SignupFinishError,
  type SignupRequestError,
} from '~/shared/signup/signup'

interface SignupSearch {
  token?: string
  status?: 'sent'
  error?: SignupRequestError | SignupFinishError
  reason?: PasswordReason
  username?: string
}

const isRequestError = (e: SignupSearch['error']): e is SignupRequestError => isOneOf(e, SIGNUP_REQUEST_ERRORS)
const isFinishError = (e: SignupSearch['error']): e is SignupFinishError => isOneOf(e, SIGNUP_FINISH_ERRORS)

export const Route = createFileRoute('/signup')({
  validateSearch: (search: Record<string, unknown>): SignupSearch => ({
    token: typeof search.token === 'string' && search.token.length <= 100 ? search.token : undefined,
    status: search.status === 'sent' ? 'sent' : undefined,
    error: SIGNUP_ERRORS.find((e) => e === search.error),
    reason: parseReason(search.reason),
    username: typeof search.username === 'string' && search.username.length <= 32 ? search.username : undefined,
  }),
  loaderDeps: ({ search }) => ({ token: search.token }),
  loader: async ({ deps }) => {
    const [page, available] = await Promise.all([getSignupPage({ data: { token: deps.token } }), getSignInAvailable()])
    return { page, open: available.signup === 'open' }
  },
  head: () => ({
    meta: [
      { title: `Create an account | ${SITE_NAME}` },
      { name: 'robots', content: 'noindex' },
      { name: 'referrer', content: 'strict-origin' },
    ],
  }),
  server: { handlers: { POST: ({ request }) => handleSignup(request) } },
  component: SignupScreen,
})

const linkClass = 'font-medium text-accent underline-offset-2 hover:underline'

function Body({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <p className="mt-6 max-w-[60ch] text-[16px] leading-relaxed text-ink" data-testid={testId}>
      {children}
    </p>
  )
}

function LinkLine({
  to,
  testId,
  children,
}: {
  to: '/login' | '/account' | '/signup'
  testId: string
  children: ReactNode
}) {
  return (
    <p className="mt-6 text-[15px]">
      <Link to={to} className={linkClass} data-testid={testId}>
        {children}
      </Link>
    </p>
  )
}

function SignupScreen() {
  const { page, open } = Route.useLoaderData()
  const { token } = Route.useSearch()
  return (
    <AccountPage
      eyebrow="Account"
      title="Create an account"
      titleTestId="sign-up-title"
      lead={
        page.state === 'request'
          ? 'Reading and listening need no account. An account keeps your highlights, bookmarks and own books, and lets you ask the book on your own API key.'
          : undefined
      }
    >
      {page.state === 'signed-in' && (
        <>
          <Body testId="sign-up-signed-in">
            You’re signed in as <strong className="font-semibold">{page.username}</strong>. Sign out first to create
            another account.
          </Body>
          <LinkLine to="/account" testId="sign-up-account-link">
            Your account
          </LinkLine>
        </>
      )}
      {page.state === 'off' && (
        <>
          <Body testId="sign-up-off">{SIGNUP_CLOSED_TEXT}</Body>
          <LinkLine to="/login" testId="sign-up-sign-in-link">
            Sign in
          </LinkLine>
        </>
      )}
      {page.state === 'invite-only' && (
        <>
          <Body testId="sign-up-invite-only">
            Accounts on Folio are by invitation. If the site’s owner sent you an invite link, open it to create your
            account.
          </Body>
          <LinkLine to="/login" testId="sign-up-sign-in-link">
            Sign in
          </LinkLine>
        </>
      )}
      {page.state === 'request' && <RequestForm />}
      {page.state === 'closed' && (
        <Notice kind="error" data-testid="sign-up-closed">
          {SIGNUP_CLOSED_TEXT}
        </Notice>
      )}
      {page.state === 'unavailable' && (
        <Notice kind="error" data-testid="sign-up-unavailable">
          {SIGNUP_UNAVAILABLE_TEXT}
        </Notice>
      )}
      {page.state === 'invalid' && (
        <>
          <Notice kind="error" data-testid="sign-up-link-invalid">
            {SIGNUP_LINK_INVALID_TEXT}
          </Notice>
          {open ? (
            <LinkLine to="/signup" testId="sign-up-new-link">
              Ask for a new one
            </LinkLine>
          ) : (
            <Body testId="sign-up-ask-owner">Ask the site’s owner for a new invite.</Body>
          )}
        </>
      )}
      {page.state === 'ready' && <FinishForm token={token ?? ''} kind={page.kind} email={page.email} />}
    </AccountPage>
  )
}

function RequestForm() {
  const { status, error } = Route.useSearch()
  if (status === 'sent')
    return (
      <>
        <Notice kind="success" data-testid="sign-up-sent">
          {SIGNUP_SENT_TEXT}
        </Notice>
        <LinkLine to="/signup" testId="sign-up-different-address">
          Use a different address
        </LinkLine>
      </>
    )
  const shown = isRequestError(error) ? error : undefined
  return (
    <>
      {shown && (
        <Notice kind="error" id="signup-error" data-testid="sign-up-error">
          {requestErrorText(shown)}
        </Notice>
      )}
      <form method="post" action="/signup" className="mt-8 max-w-[420px] space-y-5">
        <TextField
          label="Email address"
          name="email"
          type="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          hint="Folio mails you a link to finish signing up. It uses the address only for that, for resetting a forgotten password and for notices about your account."
          required
          maxLength={254}
          aria-invalid={shown === 'invalid' || undefined}
          aria-describedby={shown ? 'signup-error' : undefined}
        />
        <div hidden>
          <label>
            Website
            <input type="text" name="website" data-testid="sign-up-website" tabIndex={-1} autoComplete="off" />
          </label>
        </div>
        <Button data-testid="sign-up-send-link">Send sign-up link</Button>
      </form>
      <p className="mt-8 max-w-[60ch] text-[14px] leading-relaxed text-muted">
        What Folio keeps: your username, a hash of your password, your email address and what you add to your account.
        Nothing is sold or shared. You can download or delete all of it from your account page.{' '}
        <Link to="/privacy" className={linkClass} data-testid="sign-up-privacy">
          Privacy
        </Link>{' '}
        has the details. Making an account means you agree to the{' '}
        <Link to="/terms" className={linkClass} data-testid="sign-up-terms">
          Terms
        </Link>
        .
      </p>
      <p className="mt-4 text-[14px] text-muted">
        Already have an account?{' '}
        <Link to="/login" className={linkClass} data-testid="sign-up-sign-in-link">
          Sign in
        </Link>
      </p>
    </>
  )
}

function FinishForm({ token, kind, email }: { token: string; kind: 'email' | 'invite'; email: string | null }) {
  const { error, reason, username } = Route.useSearch()
  const shown = isFinishError(error) ? error : undefined
  const usernameError = shown === 'username' || shown === 'taken'
  const passwordError = shown === 'policy' || shown === 'mismatch'
  const describedBy = shown ? 'signup-error' : undefined
  return (
    <>
      <p className="mt-3 max-w-[60ch] text-[16px] leading-relaxed text-muted">
        {kind === 'email' ? (
          <>
            For <strong className="font-semibold text-ink">{email}</strong>.
          </>
        ) : (
          'You’ve been invited to Folio.'
        )}
      </p>
      {shown && (
        <Notice kind="error" id="signup-error" data-testid="sign-up-error">
          {finishErrorText(shown, reason)}
        </Notice>
      )}
      <form method="post" action="/signup" className="mt-8 max-w-[420px] space-y-5">
        <input type="hidden" name="token" value={token} />
        <TextField
          label="Username"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          hint="3 to 32 characters: lowercase letters, digits, - and _. It can’t be changed later."
          required
          maxLength={32}
          defaultValue={username ?? ''}
          aria-invalid={usernameError || undefined}
          aria-describedby={usernameError ? describedBy : undefined}
        />
        <TextField
          label="Password"
          name="password"
          type="password"
          data-testid="sign-up-password"
          autoComplete="new-password"
          hint="15 to 256 characters."
          required
          minLength={15}
          maxLength={256}
          aria-invalid={passwordError || undefined}
          aria-describedby={passwordError ? describedBy : undefined}
        />
        <TextField
          label="Confirm password"
          name="confirm"
          data-testid="sign-up-confirm-password"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={shown === 'mismatch' || undefined}
          aria-describedby={shown === 'mismatch' ? describedBy : undefined}
        />
        <Button data-testid="sign-up-create-account">Create account</Button>
      </form>
    </>
  )
}
