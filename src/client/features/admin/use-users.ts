import { useState, useSyncExternalStore } from 'react'
import type { AdminUserView, InviteView } from '~/shared/admin/users'
import * as requests from './admin-client'
import { UsersStore } from './users-store'

export type { Message, UsersDialog } from './users-store'

export function useUsers(initial: readonly AdminUserView[], invites: readonly InviteView[]) {
  const [store] = useState(() => new UsersStore(requests, initial, invites))
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  return {
    ...snapshot,
    choose: store.choose,
    add: store.add,
    confirm: store.confirm,
    remove: store.remove,
    openAdd: store.openAdd,
    openInvite: store.openInvite,
    invite: store.invite,
    chooseRevoke: store.chooseRevoke,
    revoke: store.revoke,
    close: store.close,
  }
}
