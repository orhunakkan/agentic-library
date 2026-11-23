import { createFileRoute, Link } from '@tanstack/react-router'
import { newPasswordText, type PasswordReason, parseReason } from '~/client/features/account/password-text'
import { AccountPage, Button, Notice, TextField } from '~/client/features/account/ui'
import { getResetPage } from '~/server/account-functions'
import { handleResetPassword } from '~/server/email/actions'
import { SITE_NAME } from '~/shared/lib/site'

interface ResetSearch {
  token?: string
  error?: 'mismatch' | 'policy' | 'unavailable'
  reason?: PasswordReason
}

const ERRORS = ['mismatch', 'policy', 'unavailable'] as const

export const Route = createFileRoute('/reset-password')({
  validateSearch: (search: Record<string, unknown>): ResetSearch => ({
    token: typeof search.token === 'string' && search.token.length <= 100 ? search.token : undefined,
    error: ERRORS.find((e) => e === search.error),
    reason: parseReason(search.reason),
  }),
  loaderDeps: ({ search }) => ({ token: search.token }),
  loader: ({ deps }) => getResetPage({ data: { token: deps.token } }),
  head: () => ({
    meta: [
      { title: `Choose a new password | ${SITE_NAME}` },
      { name: 'robots', content: 'noindex' },
      { name: 'referrer', content: 'strict-origin' },
    ],
  }),
  server: { handlers: { POST: ({ request }) => handleResetPassword(request) } },
  component: ResetPasswordPage,
})

function ResetPasswordPage() {
  const page = Route.useLoaderData()
  const { token, error, reason } = Route.useSearch()
  const fieldError = error === 'mismatch' || error === 'policy' ? error : undefined
  return (
    <AccountPage eyebrow="Account" title="Choose a new password" titleTestId="reset-password-title">
      {page.state === 'off' && (
        <Notice kind="error" data-testid="reset-password-off">
          Password reset by email isn’t set up on this server. Ask the site’s owner to reset your password.
        </Notice>
      )}
      {(page.state === 'unavailable' || error === 'unavailable') && (
        <Notice kind="error" data-testid="reset-password-unavailable">
          Password reset isn’t working right now. Try again in a few minutes.
        </Notice>
      )}
      {page.state === 'invalid' && (
        <>
          <Notice kind="error" data-testid="reset-password-invalid">
            This link has expired or was already used.
          </Notice>
          <p className="mt-6 text-[15px]">
            <Link
              to="/forgot-password"
              data-testid="reset-password-new-link"
              className="font-medium text-accent underline-offset-2 hover:underline"
            >
              Ask for a new one
            </Link>
          </p>
        </>
      )}
      {page.state === 'ready' && (
        <>
          <p className="mt-3 max-w-[60ch] text-[16px] leading-relaxed text-muted">
            For the account <strong className="font-semibold text-ink">{page.username}</strong>. Changing it signs you
            out everywhere.
          </p>
          {fieldError && (
            <Notice kind="error" id="reset-error" data-testid="reset-password-error">
              {newPasswordText(fieldError, reason)}
            </Notice>
          )}
          <form method="post" action="/reset-password" className="mt-8 max-w-[420px] space-y-5">
            <input type="hidden" name="token" value={token ?? ''} />
            <input type="hidden" name="username" autoComplete="username" value={page.username} />
            <TextField
              label="New password"
              name="password"
              type="password"
              data-testid="reset-password-new"
              autoComplete="new-password"
              hint="15 to 256 characters."
              required
              minLength={15}
              maxLength={256}
              aria-invalid={fieldError !== undefined || undefined}
              aria-describedby={fieldError ? 'reset-error' : undefined}
            />
            <TextField
              label="Confirm new password"
              name="confirm"
              data-testid="reset-password-confirm"
              type="password"
              autoComplete="new-password"
              required
              aria-invalid={fieldError === 'mismatch' || undefined}
              aria-describedby={fieldError ? 'reset-error' : undefined}
            />
            <Button data-testid="reset-password-change">Change password</Button>
          </form>
        </>
      )}
    </AccountPage>
  )
}
