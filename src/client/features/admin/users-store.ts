import {
  type AdminProblem,
  type AdminRole,
  type AdminUserView,
  type InviteView,
  type RowAction,
  sortUsers,
} from '~/shared/admin/users'
import type * as client from './admin-client'
import { type AdminResult, type ChangedUser, changeFor, doneText, problemText } from './admin-client'

export type ConfirmAction = 'disable' | 'reset-password' | 'give-pro' | 'take-pro'
const ASKS_FIRST: readonly RowAction[] = ['disable', 'reset-password', 'give-pro', 'take-pro']
const asksFirst = (action: RowAction): action is ConfirmAction => ASKS_FIRST.includes(action)

export type UsersDialog =
  | { kind: 'add' }
  | { kind: 'confirm'; action: ConfirmAction; username: string }
  | { kind: 'delete'; username: string }
  | { kind: 'password'; username: string; password: string }
  | { kind: 'invite' }
  | { kind: 'invite-link'; link: string }
  | { kind: 'revoke'; id: string }

export interface Message {
  text: string
  signedOut: boolean
}

export type StatusLine = ({ kind: 'success' | 'error' } & Message) | null

export interface UsersSnapshot {
  users: readonly AdminUserView[]
  invites: readonly InviteView[]
  busy: ReadonlySet<string>
  status: StatusLine
  dialog: UsersDialog | null
  dialogError: Message | null
  sending: boolean
}

export type UsersRequests = Pick<
  typeof client,
  'addUser' | 'changeUser' | 'deleteUser' | 'createInvite' | 'revokeInvite'
>

const newestFirst = (invites: readonly InviteView[]) =>
  [...invites].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))

const failure = (problem: AdminProblem, on: 'add' | 'change'): Message => ({
  text: problemText(problem, on),
  signedOut: problem === 'signed_out',
})

const done = (text: string): StatusLine => ({ kind: 'success', text, signedOut: false })

export class UsersStore {
  private snapshot: UsersSnapshot
  private readonly listeners = new Set<() => void>()

  constructor(
    private readonly requests: UsersRequests,
    initial: readonly AdminUserView[],
    invites: readonly InviteView[] = [],
  ) {
    this.snapshot = {
      users: sortUsers(initial),
      invites: newestFirst(invites),
      busy: new Set(),
      status: null,
      dialog: null,
      dialogError: null,
      sending: false,
    }
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = () => this.snapshot

  private set(change: Partial<UsersSnapshot>) {
    this.snapshot = { ...this.snapshot, ...change }
    for (const listener of this.listeners) listener()
  }

  private replace(user: AdminUserView) {
    const others = this.snapshot.users.filter((u) => u.username !== user.username)
    this.set({ users: sortUsers([...others, user]) })
  }

  private rowBusy(username: string, on: boolean) {
    const busy = new Set(this.snapshot.busy)
    if (on) busy.add(username)
    else busy.delete(username)
    this.set({ busy })
  }

  private async send<T>(
    username: string | null,
    request: () => Promise<AdminResult<T>>,
    on: 'add' | 'change',
  ): Promise<AdminResult<T>> {
    this.set({ sending: true, dialogError: null, status: null })
    if (username) this.rowBusy(username, true)
    const result = await request()
    if (username) this.rowBusy(username, false)
    this.set({ sending: false, dialogError: result.ok ? null : failure(result.problem, on) })
    return result
  }

  private finish(result: AdminResult<ChangedUser>, action: 'add' | ConfirmAction) {
    if (!result.ok) return
    const { user, password } = result.value
    this.replace(user)
    this.set({
      status: done(doneText(action, user.username)),
      dialog: password === null ? null : { kind: 'password', username: user.username, password },
    })
  }

  choose = async (username: string, action: RowAction): Promise<void> => {
    if (asksFirst(action)) {
      this.set({ dialog: { kind: 'confirm', action, username }, dialogError: null })
      return
    }
    if (action === 'delete') {
      this.set({ dialog: { kind: 'delete', username }, dialogError: null })
      return
    }
    if (this.snapshot.busy.has(username)) return
    this.set({ status: null })
    this.rowBusy(username, true)
    const result = await this.requests.changeUser(username, changeFor(action))
    this.rowBusy(username, false)
    if (result.ok) {
      this.replace(result.value.user)
      this.set({ status: done(doneText(action, username)) })
    } else {
      this.set({ status: { kind: 'error', ...failure(result.problem, 'change') } })
    }
  }

  openAdd = () => this.set({ dialog: { kind: 'add' }, dialogError: null })

  add = async (username: string, role: AdminRole): Promise<void> => {
    this.finish(await this.send(null, () => this.requests.addUser(username, role), 'add'), 'add')
  }

  confirm = async (): Promise<void> => {
    const { dialog } = this.snapshot
    if (dialog?.kind !== 'confirm') return
    const { username, action } = dialog
    this.finish(
      await this.send(username, () => this.requests.changeUser(username, changeFor(action)), 'change'),
      action,
    )
  }

  remove = async (): Promise<void> => {
    const { dialog } = this.snapshot
    if (dialog?.kind !== 'delete') return
    const { username } = dialog
    const result = await this.send(username, () => this.requests.deleteUser(username), 'change')
    if (!result.ok) return
    this.set({
      users: this.snapshot.users.filter((u) => u.username !== username),
      status: done(doneText('delete', username)),
      dialog: null,
    })
  }

  openInvite = () => this.set({ dialog: { kind: 'invite' }, dialogError: null })

  invite = async (note: string): Promise<void> => {
    const result = await this.send(null, () => this.requests.createInvite(note), 'change')
    if (!result.ok) return
    this.set({
      invites: newestFirst([result.value.invite, ...this.snapshot.invites]),
      dialog: { kind: 'invite-link', link: result.value.link },
    })
  }

  chooseRevoke = (id: string) => this.set({ dialog: { kind: 'revoke', id }, dialogError: null })

  revoke = async (): Promise<void> => {
    const { dialog } = this.snapshot
    if (dialog?.kind !== 'revoke') return
    const invite = this.snapshot.invites.find((i) => i.id === dialog.id)
    if (!invite) return this.close()
    this.set({ invites: this.snapshot.invites.filter((i) => i.id !== invite.id), dialog: null, status: null })
    const result = await this.requests.revokeInvite(invite.id)
    if (result.ok || result.problem === 'not_found') {
      this.set({ status: done('The invite was revoked.') })
      return
    }
    this.set({
      invites: newestFirst([...this.snapshot.invites, invite]),
      status: { kind: 'error', ...failure(result.problem, 'change') },
    })
  }

  close = () => this.set({ dialog: null, dialogError: null })
}
