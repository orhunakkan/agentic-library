import { createFileRoute, Link } from '@tanstack/react-router'
import { AccountPage, Button, Notice } from '~/client/features/account/ui'
import { getConfirmPage } from '~/server/account-functions'
import { handleConfirmEmail } from '~/server/email/actions'
import { SITE_NAME } from '~/shared/lib/site'

export const Route = createFileRoute('/confirm-email')({
  validateSearch: (search: Record<string, unknown>): { token?: string } => ({
    token: typeof search.token === 'string' && search.token.length <= 100 ? search.token : undefined,
  }),
  loaderDeps: ({ search }) => ({ token: search.token }),
  loader: ({ deps }) => getConfirmPage({ data: { token: deps.token } }),
  head: () => ({
    meta: [
      { title: `Confirm your email address | ${SITE_NAME}` },
      { name: 'robots', content: 'noindex' },
      { name: 'referrer', content: 'strict-origin' },
    ],
  }),
  server: { handlers: { POST: ({ request }) => handleConfirmEmail(request) } },
  component: ConfirmEmailPage,
})

const linkClass = 'font-medium text-accent underline-offset-2 hover:underline'

function ConfirmEmailPage() {
  const page = Route.useLoaderData()
  const { token } = Route.useSearch()
  const here = `/confirm-email?token=${token ?? ''}`
  return (
    <AccountPage eyebrow="Account" title="Confirm your email address" titleTestId="confirm-email-title">
      {page.state === 'off' && (
        <Notice kind="error" data-testid="confirm-email-off">
          Email isn’t set up on this server, so there is nothing to confirm.
        </Notice>
      )}
      {page.state === 'unavailable' && (
        <Notice kind="error" data-testid="confirm-email-unavailable">
          Confirming isn’t working right now. Try again in a few minutes.
        </Notice>
      )}
      {page.state === 'invalid' && (
        <>
          <Notice kind="error" data-testid="confirm-email-invalid">
            This link has expired or was already used.
          </Notice>
          <p className="mt-6 text-[15px]">
            <Link to="/account" hash="email" className={linkClass} data-testid="confirm-email-account-link">
              Send a new one from your account
            </Link>
          </p>
        </>
      )}
      {page.state === 'signed-out' && (
        <>
          <p className="mt-6 max-w-[60ch] text-[16px] leading-relaxed text-ink" data-testid="confirm-email-signed-out">
            Sign in to confirm this address. The link only works for the account that asked for it.
          </p>
          <a
            href={`/login?next=${encodeURIComponent(here)}`}
            data-testid="confirm-email-sign-in"
            className="mt-6 inline-flex h-12 items-center justify-center rounded-xl bg-accent-fill px-5 text-[15px] font-semibold text-on-accent hover:brightness-105"
          >
            Sign in
          </a>
        </>
      )}
      {page.state === 'other-account' && (
        <Notice kind="error" data-testid="confirm-email-other-account">
          This link is for a different account. Sign out, then open it again.
        </Notice>
      )}
      {page.state === 'ready' && (
        <form method="post" action="/confirm-email" className="mt-6 space-y-6">
          <input type="hidden" name="token" value={token ?? ''} />
          <p className="max-w-[60ch] text-[16px] leading-relaxed text-ink">
            Use <strong className="font-semibold break-all">{page.email}</strong> as your account’s email address?
          </p>
          <Button data-testid="confirm-email-confirm">Confirm address</Button>
        </form>
      )}
    </AccountPage>
  )
}
