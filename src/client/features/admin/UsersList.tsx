import { ShieldCheck } from 'lucide-react'
import { DateTime } from '~/client/features/account/ui'
import { cn } from '~/client/lib/cn'
import { type AdminUserView, type EmailStatus, type RowAction, rowActions } from '~/shared/admin/users'
import { planLabel } from '~/shared/plans/copy'
import { UserActionsMenu } from './UserActionsMenu'

interface ListProps {
  users: readonly AdminUserView[]
  busy: ReadonlySet<string>
  onChoose: (username: string, action: RowAction) => void
}

const EMAIL_TEXT: Record<EmailStatus, string> = { confirmed: 'Confirmed', bounced: 'Bounced', none: 'None' }
const EMAIL_CARD_TEXT: Record<EmailStatus, string> = {
  confirmed: 'Email confirmed',
  bounced: 'Email bounced',
  none: 'No email',
}

function Role({ user }: { user: AdminUserView }) {
  if (user.role !== 'admin') return <>Member</>
  return (
    <span className="inline-flex items-center gap-1.5">
      <ShieldCheck className="size-4 text-accent" aria-hidden />
      Admin
    </span>
  )
}

const STATUS_TONE: Record<AdminUserView['status'], string> = {
  active: 'bg-hue-lime/15 text-hue-lime-ink',
  locked: 'bg-hue-amber/15 text-hue-amber-ink',
  disabled: 'bg-panel text-muted',
}

function Status({ user }: { user: AdminUserView }) {
  return (
    <span
      data-testid="user-status"
      className={cn(
        'inline-flex rounded-full px-2.5 py-0.5 text-[13px] font-semibold whitespace-nowrap',
        STATUS_TONE[user.status],
      )}
    >
      {user.status === 'active' && 'Active'}
      {user.status === 'disabled' && 'Disabled'}
      {user.status === 'locked' && (
        <>
          Locked until&nbsp;
          <DateTime iso={user.lockedUntil ?? ''} timeOnly />
        </>
      )}
    </span>
  )
}

function You() {
  return (
    <span className="ml-2 rounded-[4px] bg-accent-soft px-1.5 py-0.5 text-[11px] font-bold tracking-[0.08em] text-accent uppercase">
      You
    </span>
  )
}

const sessionsText = (n: number) => (n === 0 ? 'No sessions' : n === 1 ? '1 session' : `${n} sessions`)

function Actions({ user, busy, onChoose }: { user: AdminUserView } & Omit<ListProps, 'users'>) {
  if (user.you) return null
  return (
    <UserActionsMenu
      username={user.username}
      actions={rowActions(user)}
      busy={busy.has(user.username)}
      onChoose={(action) => onChoose(user.username, action)}
    />
  )
}

export function UsersList({ users, busy, onChoose }: ListProps) {
  return (
    <>
      <div className="relative hidden overflow-x-auto rounded-[22px] border border-line bg-surface md:block">
        <table className="w-full min-w-[800px] text-left text-[14.5px]">
          <thead className="border-b border-line text-[13px] text-muted">
            <tr>
              <th scope="col" className="px-5 py-3 font-semibold">
                User
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                Role
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                Plan
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                Status
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                Last active
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                Sessions
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                API key
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                Email
              </th>
              <th scope="col" className="px-3 py-3">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {users.map((user) => (
              <tr key={user.username} data-testid="user" data-key={user.username}>
                <th scope="row" className="px-5 py-2.5 font-medium whitespace-nowrap text-ink">
                  {user.username}
                  {user.you && <You />}
                </th>
                <td className="px-3 py-2.5 text-ink">
                  <Role user={user} />
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap text-muted" data-testid="user-plan">
                  {planLabel(user.planSource, user.paid)}
                </td>
                <td className="px-3 py-2.5">
                  <Status user={user} />
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap text-muted">
                  {user.lastActiveAt ? <DateTime iso={user.lastActiveAt} /> : '—'}
                </td>
                <td className="px-3 py-2.5 text-muted">{user.sessions}</td>
                <td className="px-3 py-2.5 text-muted">{user.hasKey ? 'Saved' : '—'}</td>
                <td
                  className={cn(
                    'px-3 py-2.5',
                    user.email === 'bounced' ? 'text-red-700 dark:text-red-300' : 'text-muted',
                  )}
                >
                  {EMAIL_TEXT[user.email]}
                </td>
                <td className="px-3 py-1 text-right">
                  <Actions user={user} busy={busy} onChoose={onChoose} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-3 md:hidden">
        {users.map((user) => (
          <li
            key={user.username}
            data-testid="user"
            data-key={user.username}
            className="rounded-[22px] border border-line bg-surface p-4"
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium break-words text-ink">
                  {user.username}
                  {user.you && <You />}
                </p>
                <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[14px] text-muted">
                  <Role user={user} />
                  <span aria-hidden>·</span>
                  <span data-testid="user-plan">{planLabel(user.planSource, user.paid)}</span>
                  <span aria-hidden>·</span>
                  <Status user={user} />
                  <span aria-hidden>·</span>
                  <span>{sessionsText(user.sessions)}</span>
                  <span aria-hidden>·</span>
                  <span>{user.hasKey ? 'Key saved' : 'No key'}</span>
                  <span aria-hidden>·</span>
                  <span>{EMAIL_CARD_TEXT[user.email]}</span>
                </p>
                <p className="mt-1 text-[14px] text-muted">
                  Last active {user.lastActiveAt ? <DateTime iso={user.lastActiveAt} /> : '—'}
                </p>
              </div>
              <Actions user={user} busy={busy} onChoose={onChoose} />
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}
