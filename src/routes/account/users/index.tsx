import { createFileRoute, redirect } from '@tanstack/react-router'
import { UserPlus } from 'lucide-react'
import { useId } from 'react'
import { AccountPage, Button, Notice } from '~/client/features/account/ui'
import { AddUserDialog } from '~/client/features/admin/AddUserDialog'
import { ConfirmDialog, Modal, UsersSignIn } from '~/client/features/admin/ConfirmDialog'
import { DeleteUserDialog } from '~/client/features/admin/DeleteUserDialog'
import { InviteDialog } from '~/client/features/admin/InviteDialog'
import { InviteLinkPanel } from '~/client/features/admin/InviteLinkPanel'
import { InvitesList } from '~/client/features/admin/InvitesList'
import { PasswordPanel } from '~/client/features/admin/PasswordPanel'
import { UsersList } from '~/client/features/admin/UsersList'
import { type UsersDialog, useUsers } from '~/client/features/admin/use-users'
import { getUsersPage } from '~/server/account-functions'
import { SITE_NAME } from '~/shared/lib/site'

export const Route = createFileRoute('/account/users/')({
  beforeLoad: ({ context }) => {
    if (!context.viewer) throw redirect({ to: '/login', search: { next: '/account/users' } })
  },
  loader: () => getUsersPage(),
  head: () => ({ meta: [{ title: `Users | ${SITE_NAME}` }, { name: 'robots', content: 'noindex' }] }),
  component: UsersScreen,
})

const CONFIRM = {
  disable: {
    title: (u: string) => `Disable ${u}?`,
    body: 'They are signed out everywhere and can’t sign in until you enable them.',
    confirm: 'Disable',
  },
  'reset-password': {
    title: (u: string) => `Reset ${u}’s password?`,
    body: 'They are signed out everywhere. You’ll see the new password once.',
    confirm: 'Reset password',
  },
}

function UsersScreen() {
  const page = Route.useLoaderData()
  const users = useUsers(page.users, page.invites)
  const titleId = useId()
  return (
    <AccountPage
      eyebrow="Account"
      title="Users"
      titleTestId="users-title"
      lead="Everyone who can sign in to Folio. Only admins see this page."
      nav
    >
      <noscript>
        <Notice kind="error" data-testid="users-no-script">
          Managing users needs JavaScript.
        </Notice>
      </noscript>
      <div className="mt-8 flex justify-end">
        <Button type="button" variant="secondary" data-testid="users-add" onClick={users.openAdd}>
          <UserPlus className="size-4" aria-hidden />
          Add user
        </Button>
      </div>
      <div className="mt-4">
        <UsersList users={users.users} busy={users.busy} onChoose={users.choose} />
      </div>
      <InvitesList
        invites={users.invites}
        signup={page.signup}
        onInvite={users.openInvite}
        onRevoke={users.chooseRevoke}
      />
      {users.status && (
        <Notice kind={users.status.kind} data-testid="users-status">
          {users.status.text}
          {users.status.signedOut && <UsersSignIn testId="users-sign-in" />}
        </Notice>
      )}
      <Modal open={users.dialog !== null} labelledBy={titleId} onClose={users.close}>
        {users.dialog && <DialogBody dialog={users.dialog} titleId={titleId} users={users} />}
      </Modal>
    </AccountPage>
  )
}

function DialogBody({
  dialog,
  titleId,
  users,
}: {
  dialog: UsersDialog
  titleId: string
  users: ReturnType<typeof useUsers>
}) {
  switch (dialog.kind) {
    case 'add':
      return (
        <AddUserDialog
          titleId={titleId}
          sending={users.sending}
          error={users.dialogError}
          onAdd={users.add}
          onCancel={users.close}
        />
      )
    case 'confirm': {
      const copy = CONFIRM[dialog.action]
      return (
        <ConfirmDialog
          testId="user-action"
          testKey={dialog.action}
          titleId={titleId}
          title={copy.title(dialog.username)}
          body={copy.body}
          confirm={copy.confirm}
          sending={users.sending}
          error={users.dialogError}
          onConfirm={users.confirm}
          onCancel={users.close}
        />
      )
    }
    case 'delete':
      return (
        <DeleteUserDialog
          titleId={titleId}
          username={dialog.username}
          sending={users.sending}
          error={users.dialogError}
          onDelete={users.remove}
          onCancel={users.close}
        />
      )
    case 'password':
      return (
        <PasswordPanel titleId={titleId} username={dialog.username} password={dialog.password} onDone={users.close} />
      )
    case 'invite':
      return (
        <InviteDialog
          titleId={titleId}
          sending={users.sending}
          error={users.dialogError}
          onCreate={users.invite}
          onCancel={users.close}
        />
      )
    case 'invite-link':
      return <InviteLinkPanel titleId={titleId} link={dialog.link} onDone={users.close} />
    case 'revoke':
      return (
        <ConfirmDialog
          testId="invite-revoke"
          titleId={titleId}
          title="Revoke this invite?"
          body="The link stops working."
          confirm="Revoke"
          sending={users.sending}
          error={users.dialogError}
          onConfirm={users.revoke}
          onCancel={users.close}
        />
      )
  }
}
