import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { Download, Laptop } from 'lucide-react'
import { AccessTokensSection } from '~/client/features/account/AccessTokensSection'
import {
  ACCOUNT_ERRORS,
  ACCOUNT_STATUS_TEXT,
  ACCOUNT_STATUSES,
  type AccountError,
  type AccountStatus,
  accountErrorText,
  EMAIL_ERRORS,
  isEmailError,
} from '~/client/features/account/account-messages'
import { type PasswordReason, parseReason } from '~/client/features/account/password-text'
import { signOutSubmit } from '~/client/features/account/sign-out'
import { AccountPage, Button, DateTime, Notice, Section, TextField } from '~/client/features/account/ui'
import { PasskeysSection } from '~/client/features/passkeys/PasskeysSection'
import { handleAccount } from '~/server/account-actions'
import { getAccountPage } from '~/server/account-functions'
import { SITE_NAME } from '~/shared/lib/site'

type Session = Awaited<ReturnType<typeof getAccountPage>>['sessions'][number]
type EmailState = Awaited<ReturnType<typeof getAccountPage>>['email']

interface AccountSearch {
  status?: AccountStatus
  error?: AccountError
  reason?: PasswordReason
}

export const Route = createFileRoute('/account/')({
  validateSearch: (search: Record<string, unknown>): AccountSearch => ({
    status: ACCOUNT_STATUSES.find((s) => s === search.status),
    error: ACCOUNT_ERRORS.find((e) => e === search.error),
    reason: parseReason(search.reason),
  }),
  beforeLoad: ({ context }) => {
    if (!context.viewer) throw redirect({ to: '/login', search: { next: '/account' } })
  },
  loader: () => getAccountPage(),
  head: () => ({ meta: [{ title: `Account | ${SITE_NAME}` }, { name: 'robots', content: 'noindex' }] }),
  server: { handlers: { POST: ({ request }) => handleAccount(request) } },
  component: AccountScreen,
})

const isPasswordError = (error: AccountSearch['error']): error is 'mismatch' | 'policy' | 'current' =>
  error === 'mismatch' || error === 'policy' || error === 'current'

const isDeleteError = (error: AccountSearch['error']): error is 'delete-current' | 'last-admin' =>
  error === 'delete-current' || error === 'last-admin'

function AccountScreen() {
  const account = Route.useLoaderData()
  const { status, error, reason } = Route.useSearch()
  return (
    <AccountPage eyebrow="Account" title={account.username} titleTestId="account-title" nav>
      {status === 'welcome' && (
        <Notice kind="success" data-testid="account-welcome">
          Welcome to Folio, <strong className="font-semibold">{account.username}</strong>. Your account is ready.
          {account.email && !account.email.confirmed && (
            <>
              {' '}
              <a
                href="#email"
                className="font-medium underline underline-offset-2"
                data-testid="account-add-email-link"
              >
                Add an email address below
              </a>{' '}
              so you can reset a forgotten password.
            </>
          )}
        </Notice>
      )}
      {status && status !== 'welcome' && status !== 'passkey-removed' && status !== 'token-revoked' && (
        <Notice kind="success" data-testid="account-saved">
          {ACCOUNT_STATUS_TEXT[status]}
        </Notice>
      )}
      {error && !isPasswordError(error) && !isDeleteError(error) && !isEmailError(error) && (
        <Notice kind="error" data-testid="account-error">
          {accountErrorText(error, reason)}
        </Notice>
      )}

      <Section id="profile" title="Profile">
        <dl className="grid grid-cols-[auto_1fr] gap-x-8 gap-y-3 text-[15px]">
          <dt className="text-muted">Username</dt>
          <dd className="font-medium text-ink">{account.username}</dd>
          <dt className="text-muted">Role</dt>
          <dd className="font-medium text-ink">{account.role === 'admin' ? 'Admin' : 'Member'}</dd>
        </dl>
      </Section>

      <EmailSection username={account.username} email={account.email} error={error} />

      <PasswordSection username={account.username} error={error} reason={reason} />

      <PasskeysSection
        username={account.username}
        initial={account.passkeys}
        max={account.passkeyMax}
        removed={status === 'passkey-removed' ? ACCOUNT_STATUS_TEXT['passkey-removed'] : null}
      />

      <SessionsSection sessions={account.sessions} />

      <AccessTokensSection tokens={account.accessTokens} revoked={status === 'token-revoked'} />

      <form method="post" action="/logout" className="mt-10" onSubmit={signOutSubmit}>
        <Button variant="secondary" data-testid="account-page-sign-out">
          Sign out
        </Button>
      </form>

      <DataSection />

      <DeleteSection username={account.username} error={error} />
    </AccountPage>
  )
}

const mutedText = 'max-w-[60ch] text-[15px] leading-relaxed text-muted'

function EmailSection({
  username,
  email,
  error,
}: {
  username: string
  email: EmailState
  error: AccountSearch['error']
}) {
  const shown = isEmailError(error) ? error : undefined
  if (!email)
    return (
      <Section id="email" title="Email">
        <p className={mutedText} data-testid="account-email-off">
          Email isn’t set up on this server, so Folio can’t send you anything yet. If you forget your password, the
          site’s owner can reset it.
        </p>
      </Section>
    )
  const { confirmed, pending } = email
  const bounced = [
    ...(confirmed && email.bounced ? [confirmed.email] : []),
    ...(pending?.bounced ? [pending.email] : []),
  ]
  const heading = confirmed ? 'Change address' : pending ? 'Use a different address' : null
  return (
    <Section id="email" title="Email">
      {!confirmed && !pending && (
        <p className={mutedText}>
          Add an email address so you can reset your password if you forget it. Folio uses it for nothing else, and only
          once you’ve confirmed it.
        </p>
      )}
      {bounced.map((address) => (
        <Notice kind="error" key={address} data-testid="account-email-bounced">
          Mail to {address} bounced or was marked as spam, so Folio has stopped sending to it. Use a different address,
          or ask the site’s owner to clear it if it works again.
        </Notice>
      ))}
      {shown && (
        <Notice kind="error" id="email-error" data-testid="account-email-error">
          {EMAIL_ERRORS[shown]}
        </Notice>
      )}
      {confirmed && (
        <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-8 gap-y-3 text-[15px] first:mt-0">
          <dt className="text-muted">Email</dt>
          <dd className="font-medium break-all text-ink" data-testid="account-email-confirmed">
            {confirmed.email}
          </dd>
          <dt className="text-muted">Confirmed</dt>
          <dd className="font-medium text-ink">
            <DateTime iso={confirmed.verifiedAt} />
          </dd>
        </dl>
      )}
      {pending && (
        <div className="mt-6 first:mt-0">
          <p className="text-[15px] leading-relaxed text-ink" data-testid="account-email-pending">
            Waiting for confirmation: <strong className="font-semibold break-all">{pending.email}</strong>. Open the
            link we sent within 24 hours, while signed in.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {!pending.bounced && (
              <form method="post" action="/account">
                <input type="hidden" name="intent" value="email-resend" />
                <Button variant="secondary" data-testid="account-email-resend">
                  Send it again
                </Button>
              </form>
            )}
            <form method="post" action="/account">
              <input type="hidden" name="intent" value="email-remove" />
              <input type="hidden" name="pending" value="1" />
              <button
                type="submit"
                data-testid="account-email-cancel"
                className="inline-flex h-12 items-center rounded-xl px-3 text-[15px] font-semibold text-accent underline-offset-2 hover:underline"
              >
                Cancel
              </button>
            </form>
          </div>
        </div>
      )}
      <form method="post" action="/account" className="mt-6 space-y-5 first:mt-0">
        {heading && <h3 className="font-display text-[17px] font-bold tracking-[-0.01em] text-ink">{heading}</h3>}
        {confirmed && (
          <p className="text-[14px] text-muted">Your current address stays in use until you confirm the new one.</p>
        )}
        <input type="hidden" name="intent" value="email-add" />
        <input type="hidden" name="username" autoComplete="username" value={username} />
        <TextField
          label="Email address"
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={254}
          aria-invalid={shown === 'email-invalid' || shown === 'email-same' || undefined}
          aria-describedby={shown ? 'email-error' : undefined}
        />
        <TextField
          id="field-email-current"
          data-testid="account-email-current-password"
          label="Current password"
          name="current"
          type="password"
          autoComplete="current-password"
          required
          maxLength={1024}
          aria-invalid={shown === 'email-current' || undefined}
          aria-describedby={shown ? 'email-error' : undefined}
        />
        <Button data-testid="account-email-send">Send confirmation link</Button>
      </form>
      {confirmed && (
        <form method="post" action="/account" className="mt-8 border-t border-line pt-6">
          <input type="hidden" name="intent" value="email-remove" />
          <Button variant="secondary" data-testid="account-email-remove">
            Remove address
          </Button>
          <p className="mt-3 text-[13.5px] text-muted">Without an address you can’t reset a forgotten password.</p>
        </form>
      )}
    </Section>
  )
}

function DataSection() {
  return (
    <Section id="data" title="Your data">
      <p className={mutedText}>
        Everything your account holds, in one JSON file: your highlights and notes, bookmarks, shelves, reading and
        listening places, settings, the details of your private books and audiobooks (with their chapters), your
        sessions and your account’s activity. Your private books’ pages and pictures aren’t included; you have the files
        you imported. Audiobook files aren’t in the export.
      </p>
      <a
        href="/account/export"
        download
        data-testid="account-download-data"
        className="mt-5 inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-5 text-[15px] font-semibold text-ink transition hover:border-accent-line hover:bg-panel"
      >
        <Download className="size-4" aria-hidden />
        Download your data
      </a>
      <p className="mt-4 text-[13.5px] text-muted">
        Highlights and notes are also on the{' '}
        <Link
          to="/account/highlights"
          data-testid="account-highlights-link"
          className="font-medium text-accent underline-offset-2 hover:underline"
        >
          Highlights
        </Link>{' '}
        page as Markdown.
      </p>
    </Section>
  )
}

function DeleteSection({ username, error }: { username: string; error: AccountSearch['error'] }) {
  const shown = isDeleteError(error) ? error : undefined
  return (
    <Section id="delete" title="Delete account">
      <p className={mutedText}>
        This deletes your account and everything in it for good: highlights, notes, bookmarks, shelves, private books,
        your saved API key and every session. Download your data first if you want a copy. It can’t be undone.
      </p>
      {shown && (
        <Notice kind="error" id="delete-error" data-testid="account-delete-error">
          {accountErrorText(shown, undefined)}
        </Notice>
      )}
      <form method="post" action="/account" className="mt-5 space-y-5">
        <input type="hidden" name="intent" value="delete-account" />
        <input type="hidden" name="username" autoComplete="username" value={username} />
        <TextField
          id="field-delete-current"
          data-testid="account-delete-current-password"
          label="Current password"
          name="current"
          type="password"
          autoComplete="current-password"
          required
          maxLength={1024}
          aria-invalid={shown === 'delete-current' || undefined}
          aria-describedby={shown ? 'delete-error' : undefined}
        />
        <Button variant="danger" data-testid="account-delete">
          Delete my account
        </Button>
      </form>
    </Section>
  )
}

function PasswordSection({
  username,
  error,
  reason,
}: {
  username: string
  error: AccountSearch['error']
  reason: AccountSearch['reason']
}) {
  return (
    <Section id="password" title="Change password">
      {isPasswordError(error) && (
        <Notice kind="error" id="password-error" data-testid="account-password-error">
          {accountErrorText(error, reason)}
        </Notice>
      )}
      <form method="post" action="/account" className="space-y-5">
        <input type="hidden" name="intent" value="change-password" />
        <input type="hidden" name="username" autoComplete="username" value={username} />
        <TextField
          label="Current password"
          name="current"
          type="password"
          data-testid="account-current-password"
          autoComplete="current-password"
          required
          aria-invalid={error === 'current' || undefined}
          aria-describedby={error === 'current' ? 'password-error' : undefined}
        />
        <TextField
          label="New password"
          name="password"
          data-testid="account-new-password"
          type="password"
          autoComplete="new-password"
          hint="At least 15 characters. A few unrelated words make a good one."
          required
          minLength={15}
          maxLength={256}
          aria-invalid={error === 'policy' || error === 'mismatch' || undefined}
        />
        <TextField
          label="Repeat new password"
          name="confirm"
          data-testid="account-confirm-password"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={error === 'mismatch' || undefined}
        />
        <p className="text-[13.5px] text-muted">Changing it signs out every other session.</p>
        <Button data-testid="account-change-password">Change password</Button>
      </form>
    </Section>
  )
}

function SessionsSection({ sessions }: { sessions: Session[] }) {
  const others = sessions.filter((s) => !s.current).length
  return (
    <Section id="sessions" title="Sessions">
      <ul className="divide-y divide-line">
        {sessions.map((session) => (
          <li
            key={`${session.createdAt}-${session.device}`}
            data-testid="account-session"
            data-key={`${session.createdAt}-${session.device}`}
            className="flex items-start gap-3 py-3 first:pt-0 last:pb-0"
          >
            <Laptop className="mt-0.5 size-5 shrink-0 text-subtle" aria-hidden />
            <div className="min-w-0 text-[14.5px]">
              <p className="font-medium text-ink">
                {session.device}
                {session.current && (
                  <span
                    data-testid="account-session-current"
                    className="ml-2 rounded-[4px] bg-accent-soft px-1.5 py-0.5 text-[11px] font-bold tracking-[0.08em] text-accent uppercase"
                  >
                    This device
                  </span>
                )}
              </p>
              <p className="text-muted">
                Last active <DateTime iso={session.lastSeenAt} />
                {session.ip && <> · {session.ip}</>}
              </p>
            </div>
          </li>
        ))}
      </ul>
      {others > 0 && (
        <form method="post" action="/account" className="mt-5">
          <input type="hidden" name="intent" value="revoke-others" />
          <Button variant="secondary" data-testid="account-sign-out-others">
            Sign out everywhere else
          </Button>
        </form>
      )}
    </Section>
  )
}
