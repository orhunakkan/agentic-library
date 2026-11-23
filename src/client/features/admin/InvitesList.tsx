import { Mail } from 'lucide-react'
import { Button } from '~/client/features/account/ui'
import type { InviteView } from '~/shared/admin/users'
import { shortDate } from '~/shared/lib/site'
import type { SignupMode } from '~/shared/signup/signup'

export function InvitesList({
  invites,
  signup,
  onInvite,
  onRevoke,
}: {
  invites: readonly InviteView[]
  signup: SignupMode
  onInvite: () => void
  onRevoke: (id: string) => void
}) {
  return (
    <section id="invites" aria-labelledby="invites-title" className="mt-12">
      <h2 id="invites-title" className="font-display text-[22px] font-bold tracking-[-0.02em] text-ink">
        Invites
      </h2>
      {signup === 'off' ? (
        <p className="mt-3 text-[15px] leading-relaxed text-muted" data-testid="invite-off">
          Sign-up is turned off on this server, so invites can’t be made.
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <p className="max-w-[46ch] text-[15px] leading-relaxed text-muted">
              An invite link lets one person create a member account. It works once, for 7 days.
            </p>
            <Button
              type="button"
              variant="secondary"
              data-testid="invite-open"
              onClick={onInvite}
              className="shrink-0 self-start"
            >
              <Mail className="size-4" aria-hidden />
              Invite someone
            </Button>
          </div>
          {invites.length === 0 ? (
            <p className="mt-5 text-[15px] text-muted" data-testid="invite-empty">
              No open invites.
            </p>
          ) : (
            <ul
              aria-label="Open invites"
              className="mt-5 divide-y divide-line rounded-[22px] border border-line bg-surface"
            >
              {invites.map((invite) => (
                <li
                  key={invite.id}
                  data-testid="invite"
                  data-key={invite.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
                >
                  <div className="min-w-0">
                    <p className="font-medium break-words text-ink">{invite.note ?? 'No note'}</p>
                    <p className="mt-1 text-[14px] text-muted">
                      {invite.by ? (
                        <>
                          Made by <strong className="font-semibold text-ink">{invite.by}</strong>
                        </>
                      ) : (
                        'Made by a deleted account'
                      )}
                      {' · '}
                      Expires <time dateTime={invite.expiresAt}>{shortDate(invite.expiresAt)}</time>
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="danger"
                    data-testid="invite-revoke"
                    data-key={invite.id}
                    className="h-11"
                    onClick={() => onRevoke(invite.id)}
                    aria-label={`Revoke the invite: ${invite.note ?? 'No note'}`}
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
