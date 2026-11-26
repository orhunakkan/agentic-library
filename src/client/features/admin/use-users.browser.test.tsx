import { describe, expect, it, vi } from 'vitest'
import { mountHook } from '~/client/testing/mount'
import type { AdminUserView, InviteView } from '~/shared/admin/users'
import type * as client from './admin-client'
import type { AdminResult, ChangedUser } from './admin-client'
import { useUsers } from './use-users'

/** The requests the hook's store sends, answered by each test; the wording helpers stay real. */
const requests = vi.hoisted(() => ({
  addUser: vi.fn(),
  changeUser: vi.fn(),
  deleteUser: vi.fn(),
  createInvite: vi.fn(),
  revokeInvite: vi.fn(),
}))
vi.mock('./admin-client', async (importOriginal) => ({ ...(await importOriginal<typeof client>()), ...requests }))

const user = (username: string, change: Partial<AdminUserView> = {}): AdminUserView => ({
  username,
  role: 'member',
  status: 'active',
  lockedUntil: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  lastActiveAt: null,
  sessions: 0,
  hasKey: false,
  email: 'none',
  you: false,
  ...change,
})

const invite = (id: string, createdAt: string): InviteView => ({
  id,
  note: null,
  by: 'admin',
  createdAt,
  expiresAt: '2026-12-31T00:00:00.000Z',
})

const props = (users: readonly AdminUserView[], invites: readonly InviteView[] = []) => ({ users, invites })
const useUsersOf = ({ users, invites }: ReturnType<typeof props>) => useUsers(users, invites)

const names = (users: readonly AdminUserView[]) => users.map((u) => u.username)

describe('useUsers', () => {
  it('starts with the users and invites it is given, and no dialog or message', () => {
    const hook = mountHook(
      useUsersOf,
      props(
        [user('bea'), user('ada')],
        [invite('older', '2026-11-01T00:00:00.000Z'), invite('newer', '2026-11-02T00:00:00.000Z')],
      ),
    )
    expect(names(hook.current.users)).toEqual(['ada', 'bea'])
    expect(hook.current.invites.map((made) => made.id)).toEqual(['newer', 'older'])
    expect(hook.current).toMatchObject({ status: null, dialog: null, dialogError: null, sending: false })
    expect(hook.current.busy.size).toBe(0)
  })

  it('shows a row as busy while its change is sent, then the changed user', async () => {
    const answer = Promise.withResolvers<AdminResult<ChangedUser>>()
    requests.changeUser.mockReturnValue(answer.promise)
    const hook = mountHook(useUsersOf, props([user('ada')]))

    const choosing = hook.current.choose('ada', 'make-admin')
    await vi.waitFor(() => expect(hook.current.busy.has('ada')).toBe(true))
    expect(requests.changeUser).toHaveBeenCalledWith('ada', { intent: 'role', role: 'admin' })

    answer.resolve({ ok: true, value: { user: user('ada', { role: 'admin' }), password: null } })
    await choosing
    await vi.waitFor(() => expect(hook.current.busy.has('ada')).toBe(false))
    expect(hook.current.users[0]?.role).toBe('admin')
    expect(hook.current.status).toEqual({ kind: 'success', text: 'ada is now an admin.', signedOut: false })
  })

  it('keeps the user as they were when the server refuses a change', async () => {
    requests.changeUser.mockResolvedValue({ ok: false, problem: 'last_admin' })
    const ada = user('ada', { role: 'admin' })
    const hook = mountHook(useUsersOf, props([ada]))

    await hook.current.choose('ada', 'make-member')

    await vi.waitFor(() => expect(hook.current.status?.kind).toBe('error'))
    expect(hook.current.users).toEqual([ada])
    expect(hook.current.busy.size).toBe(0)
  })

  it('opens and closes its dialogs', async () => {
    const hook = mountHook(useUsersOf, props([user('ada')]))
    hook.current.openAdd()
    await expect.poll(() => hook.current.dialog).toEqual({ kind: 'add' })
    hook.current.close()
    await expect.poll(() => hook.current.dialog).toBeNull()
    await hook.current.choose('ada', 'delete')
    await expect.poll(() => hook.current.dialog).toEqual({ kind: 'delete', username: 'ada' })
  })

  it('shows the invite gone at once, and back when the server refuses to revoke it', async () => {
    const answer = Promise.withResolvers<AdminResult<string>>()
    requests.revokeInvite.mockReturnValue(answer.promise)
    const hook = mountHook(useUsersOf, props([], [invite('one', '2026-11-01T00:00:00.000Z')]))

    hook.current.chooseRevoke('one')
    await expect.poll(() => hook.current.dialog).toEqual({ kind: 'revoke', id: 'one' })
    const revoking = hook.current.revoke()
    await expect.poll(() => hook.current.invites).toEqual([])
    expect(hook.current.dialog).toBeNull()

    answer.resolve({ ok: false, problem: 'failed' })
    await revoking
    await vi.waitFor(() => expect(hook.current.invites.map((made) => made.id)).toEqual(['one']))
    expect(hook.current.status?.kind).toBe('error')
  })

  it('keeps its own users when it is rendered again with another list', async () => {
    requests.deleteUser.mockResolvedValue({ ok: true, value: 'ada' })
    const hook = mountHook(useUsersOf, props([user('ada'), user('bea')]))
    await hook.current.choose('ada', 'delete')
    await hook.current.remove()
    await vi.waitFor(() => expect(names(hook.current.users)).toEqual(['bea']))

    hook.rerender(props([user('ada'), user('bea'), user('cy')]))
    expect(names(hook.current.users)).toEqual(['bea'])
  })
})
