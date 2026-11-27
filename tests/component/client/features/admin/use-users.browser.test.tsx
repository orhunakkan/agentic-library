import { beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import { useUsers } from '~/client/features/admin/use-users'
import type { AdminProblem, AdminUserView, InviteView } from '~/shared/admin/users'
import type { ErrorAnswer } from '../../../../support/client/answers'
import { mountHook } from '../../../../support/client/mount'

/**
 * A user or invite endpoint's answer, as `src/server/admin/actions.ts` and `invites.ts` send it. The refusal codes are
 * the shared `AdminProblem`; the success bodies have no shared type, so they are written to match the handlers.
 */
const adminJson = (
  status: number,
  body: { user: AdminUserView } | { deleted: string } | { revoked: string } | ErrorAnswer<AdminProblem>,
) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** The network: each test says what the admin endpoints answer, and a request it didn't expect gets no answer. */
let fetchSpy: MockInstance<typeof fetch>

/** Each request sent to the network, as its path, method and JSON body. */
const sent = () =>
  fetchSpy.mock.calls.map(([path, init]) => ({
    path: String(path),
    method: init?.method,
    body: JSON.parse(String(init?.body)) as unknown,
  }))

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No answer for this request'))
})

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
    const answer = Promise.withResolvers<Response>()
    fetchSpy.mockReturnValue(answer.promise)
    const hook = mountHook(useUsersOf, props([user('ada')]))

    const choosing = hook.current.choose('ada', 'make-admin')
    await vi.waitFor(() => expect(hook.current.busy.has('ada')).toBe(true))
    expect(sent()).toEqual([{ path: '/account/users/ada', method: 'POST', body: { intent: 'role', role: 'admin' } }])

    answer.resolve(adminJson(200, { user: user('ada', { role: 'admin' }) }))
    await choosing
    await vi.waitFor(() => expect(hook.current.busy.has('ada')).toBe(false))
    expect(hook.current.users[0]?.role).toBe('admin')
    expect(hook.current.status).toEqual({ kind: 'success', text: 'ada is now an admin.', signedOut: false })
  })

  it('keeps the user as they were when the server refuses a change', async () => {
    fetchSpy.mockResolvedValue(adminJson(409, { error: 'last_admin' }))
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
    const answer = Promise.withResolvers<Response>()
    fetchSpy.mockReturnValue(answer.promise)
    const hook = mountHook(useUsersOf, props([], [invite('one', '2026-11-01T00:00:00.000Z')]))

    hook.current.chooseRevoke('one')
    await expect.poll(() => hook.current.dialog).toEqual({ kind: 'revoke', id: 'one' })
    const revoking = hook.current.revoke()
    await expect.poll(() => hook.current.invites).toEqual([])
    expect(hook.current.dialog).toBeNull()

    answer.resolve(adminJson(500, { error: 'failed' }))
    await revoking
    await vi.waitFor(() => expect(hook.current.invites.map((made) => made.id)).toEqual(['one']))
    expect(hook.current.status?.kind).toBe('error')
  })

  it('keeps its own users when it is rendered again with another list', async () => {
    fetchSpy.mockResolvedValue(adminJson(200, { deleted: 'ada' }))
    const hook = mountHook(useUsersOf, props([user('ada'), user('bea')]))
    await hook.current.choose('ada', 'delete')
    await hook.current.remove()
    await vi.waitFor(() => expect(names(hook.current.users)).toEqual(['bea']))

    hook.rerender(props([user('ada'), user('bea'), user('cy')]))
    expect(names(hook.current.users)).toEqual(['bea'])
  })
})
