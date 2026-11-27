import { describe, expect, it, vi } from 'vitest'
import type { AdminResult, ChangedUser } from '~/client/features/admin/admin-client'
import { type UsersRequests, UsersStore } from '~/client/features/admin/users-store'
import type { AdminProblem, AdminUserView, InviteView } from '~/shared/admin/users'

const view = (username: string, over: Partial<AdminUserView> = {}): AdminUserView => ({
  username,
  role: 'member',
  status: 'active',
  lockedUntil: null,
  createdAt: '2026-11-06T12:00:00.000Z',
  lastActiveAt: null,
  sessions: 0,
  hasKey: false,
  email: 'none',
  you: false,
  ...over,
})

const ok = <T>(value: T): AdminResult<T> => ({ ok: true, value })
const no = (problem: AdminProblem): AdminResult<never> => ({ ok: false, problem })
const changed = (user: AdminUserView, password: string | null = null): AdminResult<ChangedUser> =>
  ok({ user, password })

const LINK = 'https://agenticlibrary.app/signup?token=abc'

const invite = (id: string, note: string | null, createdAt: string): InviteView => ({
  id,
  note,
  by: 'zed',
  createdAt,
  expiresAt: '2026-11-13T12:00:00.000Z',
})

const ids = (invites: readonly InviteView[]) => invites.map((i) => i.id)

function setup(requests: Partial<UsersRequests> = {}) {
  const fakes: UsersRequests = {
    addUser: vi.fn(async (username: string) => changed(view(username), 'generated-password-0001')),
    changeUser: vi.fn(async (username: string) => changed(view(username))),
    deleteUser: vi.fn(async (username: string) => ok(username)),
    createInvite: vi.fn(async (note: string) =>
      ok({ invite: invite('new', note || null, '2026-11-06T13:00:00.000Z'), link: LINK }),
    ),
    revokeInvite: vi.fn(async (id: string) => ok(id)),
    ...requests,
  }
  const store = new UsersStore(
    fakes,
    [view('zed', { you: true, role: 'admin' }), view('ada'), view('bob')],
    [invite('older', 'for Bob', '2026-11-05T12:00:00.000Z'), invite('newer', null, '2026-11-06T12:00:00.000Z')],
  )
  return { store, fakes, now: () => store.getSnapshot() }
}

describe('UsersStore', () => {
  it('starts sorted by username, with nothing open', () => {
    const { now } = setup()
    expect(now().users.map((u) => u.username)).toEqual(['ada', 'bob', 'zed'])
    expect(now()).toMatchObject({ status: null, dialog: null, dialogError: null, sending: false })
  })

  it('acts at once on the immediate items, replacing the row from the answer', async () => {
    const { store, fakes, now } = setup({
      changeUser: vi.fn(async () => changed(view('ada', { role: 'admin' }))),
    })
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    const making = store.choose('ada', 'make-admin')
    expect(now().busy.has('ada')).toBe(true)
    await making
    expect(fakes.changeUser).toHaveBeenCalledWith('ada', { intent: 'role', role: 'admin' })
    expect(now().busy.has('ada')).toBe(false)
    expect(now().users.find((u) => u.username === 'ada')?.role).toBe('admin')
    expect(now().status).toEqual({ kind: 'success', text: 'ada is now an admin.', signedOut: false })
    expect(listener).toHaveBeenCalled()
    unsubscribe()
    listener.mockClear()
    await store.choose('bob', 'unlock')
    expect(listener).not.toHaveBeenCalled()
  })

  it('ignores a second choice on a row while its request is on its way', async () => {
    let answer: (value: AdminResult<ChangedUser>) => void = () => {}
    const { store, fakes } = setup({
      changeUser: vi.fn(() => new Promise<AdminResult<ChangedUser>>((resolve) => (answer = resolve))),
    })
    const first = store.choose('ada', 'unlock')
    await store.choose('ada', 'sign-out')
    expect(fakes.changeUser).toHaveBeenCalledTimes(1)
    answer(changed(view('ada')))
    await first
  })

  it('shows a refusal in the status line, with a way back to sign in for signed_out', async () => {
    const { store, now } = setup({ changeUser: vi.fn(async () => no('last_admin')) })
    await store.choose('ada', 'make-member')
    expect(now().status).toEqual({
      kind: 'error',
      text: 'Folio needs at least one admin. Make someone else an admin first.',
      signedOut: false,
    })
    const signedOut = setup({ changeUser: vi.fn(async () => no('signed_out')) })
    await signedOut.store.choose('ada', 'enable')
    expect(signedOut.now().status).toMatchObject({ kind: 'error', signedOut: true })
  })

  it('asks before Disable and Reset password, then closes or shows the password', async () => {
    const { store, fakes, now } = setup({
      changeUser: vi.fn(async (username: string, change) =>
        change.intent === 'reset-password'
          ? changed(view(username), 'new-password-for-ada-01')
          : changed(view(username, { status: 'disabled' })),
      ),
    })
    await store.choose('ada', 'disable')
    expect(now().dialog).toEqual({ kind: 'confirm', action: 'disable', username: 'ada' })
    expect(fakes.changeUser).not.toHaveBeenCalled()
    await store.confirm()
    expect(fakes.changeUser).toHaveBeenCalledWith('ada', { intent: 'disable' })
    expect(now().dialog).toBeNull()
    expect(now().users.find((u) => u.username === 'ada')?.status).toBe('disabled')
    expect(now().status?.text).toBe('ada was disabled.')

    await store.choose('ada', 'reset-password')
    await store.confirm()
    expect(now().dialog).toEqual({ kind: 'password', username: 'ada', password: 'new-password-for-ada-01' })
    expect(now().status?.text).toBe('ada’s password was reset.')
    store.close()
    expect(now().dialog).toBeNull()
    expect(JSON.stringify(now())).not.toContain('new-password-for-ada-01')
  })

  it('keeps a confirm dialog open with its error when the server refuses', async () => {
    const { store, now } = setup({ changeUser: vi.fn(async () => no('not_found')) })
    await store.choose('ada', 'disable')
    await store.confirm()
    expect(now().dialog).toMatchObject({ kind: 'confirm' })
    expect(now().dialogError).toEqual({ text: 'That user no longer exists. Reload the page.', signedOut: false })
    expect(now().sending).toBe(false)
  })

  it('adds a user into its place in the list and shows their password', async () => {
    const { store, fakes, now } = setup()
    store.openAdd()
    expect(now().dialog).toEqual({ kind: 'add' })
    const adding = store.add('cat', 'admin')
    expect(now().sending).toBe(true)
    await adding
    expect(fakes.addUser).toHaveBeenCalledWith('cat', 'admin')
    expect(now().users.map((u) => u.username)).toEqual(['ada', 'bob', 'cat', 'zed'])
    expect(now().dialog).toEqual({ kind: 'password', username: 'cat', password: 'generated-password-0001' })
    expect(now().status?.text).toBe('cat was added.')
  })

  it('shows an add refusal in the dialog, worded for the username', async () => {
    const { store, now } = setup({ addUser: vi.fn(async () => no('invalid')) })
    store.openAdd()
    await store.add('x', 'member')
    expect(now().dialog).toEqual({ kind: 'add' })
    expect(now().dialogError?.text).toBe(
      'Usernames are 3–32 characters: a–z, 0–9, _ and -, starting with a letter or digit.',
    )
    expect(now().users).toHaveLength(3)
  })

  it('deletes the user the dialog names, and keeps the row when refused', async () => {
    const { store, fakes, now } = setup()
    await store.choose('bob', 'delete')
    expect(now().dialog).toEqual({ kind: 'delete', username: 'bob' })
    await store.remove()
    expect(fakes.deleteUser).toHaveBeenCalledWith('bob')
    expect(now().users.map((u) => u.username)).toEqual(['ada', 'zed'])
    expect(now()).toMatchObject({ dialog: null, status: { text: 'bob was deleted.' } })

    const refused = setup({ deleteUser: vi.fn(async () => no('failed')) })
    await refused.store.choose('bob', 'delete')
    await refused.store.remove()
    expect(refused.now().users).toHaveLength(3)
    expect(refused.now().dialogError?.text).toBe('Something went wrong. Try again in a few minutes.')
  })

  it('does nothing when confirm or remove has no dialog of its kind', async () => {
    const { store, fakes } = setup()
    await store.confirm()
    await store.remove()
    store.openAdd()
    await store.confirm()
    await store.remove()
    expect(fakes.changeUser).not.toHaveBeenCalled()
    expect(fakes.deleteUser).not.toHaveBeenCalled()
  })
})

describe('UsersStore invites', () => {
  it('lists the pending invites newest first', () => {
    const { now } = setup()
    expect(ids(now().invites)).toEqual(['newer', 'older'])
  })

  it('makes an invite: the link goes in its panel, the invite to the top, and closing forgets the link', async () => {
    const { store, fakes, now } = setup()
    store.openInvite()
    expect(now().dialog).toEqual({ kind: 'invite' })
    await store.invite('for Ann')
    expect(fakes.createInvite).toHaveBeenCalledWith('for Ann')
    expect(now().dialog).toEqual({ kind: 'invite-link', link: LINK })
    expect(ids(now().invites)).toEqual(['new', 'newer', 'older'])
    store.close()
    expect(now().dialog).toBeNull()
    expect(JSON.stringify(now())).not.toContain(LINK)
  })

  it('shows quota and closed in the dialog, and adds nothing', async () => {
    for (const [problem, text] of [
      ['quota', 'There are already 20 open invites. Revoke one first.'],
      ['closed', 'Sign-up is turned off on this server, so invites can’t be made.'],
    ] as const) {
      const { store, now } = setup({ createInvite: vi.fn(async () => no(problem)) })
      store.openInvite()
      await store.invite('')
      expect(now().dialog).toEqual({ kind: 'invite' })
      expect(now().dialogError).toEqual({ text, signedOut: false })
      expect(now().sending).toBe(false)
      expect(ids(now().invites)).toEqual(['newer', 'older'])
    }
  })

  it('revokes after the confirm, removing the row at once', async () => {
    let finish: (value: AdminResult<string>) => void = () => {}
    const { store, fakes, now } = setup({
      revokeInvite: vi.fn(() => new Promise<AdminResult<string>>((resolve) => (finish = resolve))),
    })
    store.chooseRevoke('older')
    expect(now().dialog).toEqual({ kind: 'revoke', id: 'older' })
    const done = store.revoke()
    expect(ids(now().invites)).toEqual(['newer'])
    expect(now().dialog).toBeNull()
    finish(ok('older'))
    await done
    expect(fakes.revokeInvite).toHaveBeenCalledWith('older')
    expect(now().status).toEqual({ kind: 'success', text: 'The invite was revoked.', signedOut: false })
  })

  it('puts a refused revoke back, in its place, unless the invite is gone anyway', async () => {
    const refused = setup({ revokeInvite: vi.fn(async () => no('failed')) })
    refused.store.chooseRevoke('newer')
    await refused.store.revoke()
    expect(ids(refused.now().invites)).toEqual(['newer', 'older'])
    expect(refused.now().status).toMatchObject({
      kind: 'error',
      text: 'Something went wrong. Try again in a few minutes.',
    })

    const gone = setup({ revokeInvite: vi.fn(async () => no('not_found')) })
    gone.store.chooseRevoke('newer')
    await gone.store.revoke()
    expect(ids(gone.now().invites)).toEqual(['older'])
    expect(gone.now().status).toMatchObject({ kind: 'success' })
  })

  it('does nothing for a revoke without its dialog, and closes one for an invite no longer listed', async () => {
    const { store, fakes, now } = setup()
    await store.revoke()
    store.chooseRevoke('missing')
    await store.revoke()
    expect(fakes.revokeInvite).not.toHaveBeenCalled()
    expect(now().dialog).toBeNull()
  })
})
