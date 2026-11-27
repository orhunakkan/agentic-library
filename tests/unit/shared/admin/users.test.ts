import { describe, expect, it } from 'vitest'
import { type AdminUserView, emailStatus, rowActions, sortUsers } from '~/shared/admin/users'

const view = (over: Partial<AdminUserView> = {}): AdminUserView => ({
  username: 'ada',
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

describe('rowActions', () => {
  it('offers an active member without sessions the basic set', () => {
    expect(rowActions(view())).toEqual(['reset-password', 'make-admin', 'disable', 'delete'])
  })

  it('offers an admin Make member instead', () => {
    expect(rowActions(view({ role: 'admin' }))).toEqual(['reset-password', 'make-member', 'disable', 'delete'])
  })

  it('offers Sign out everywhere only with a session', () => {
    expect(rowActions(view({ sessions: 2 }))).toEqual(['reset-password', 'make-admin', 'sign-out', 'disable', 'delete'])
  })

  it('offers Unlock only while locked', () => {
    const locked = view({ status: 'locked', lockedUntil: '2026-11-06T12:15:00.000Z' })
    expect(rowActions(locked)).toEqual(['reset-password', 'make-admin', 'unlock', 'disable', 'delete'])
  })

  it('offers Enable for a disabled account, and still Unlock when its name is locked', () => {
    expect(rowActions(view({ status: 'disabled' }))).toEqual(['reset-password', 'make-admin', 'enable', 'delete'])
    const both = view({ status: 'disabled', role: 'admin', lockedUntil: '2026-11-06T12:15:00.000Z' })
    expect(rowActions(both)).toEqual(['reset-password', 'make-member', 'unlock', 'enable', 'delete'])
  })

  it('offers nothing on your own row', () => {
    expect(rowActions(view({ you: true, role: 'admin', sessions: 1 }))).toEqual([])
  })
})

describe('sortUsers', () => {
  it('sorts by username without changing the list it was given', () => {
    const given = [view({ username: 'zed' }), view({ username: 'ada' }), view({ username: 'bob' })]
    expect(sortUsers(given).map((u) => u.username)).toEqual(['ada', 'bob', 'zed'])
    expect(given.map((u) => u.username)).toEqual(['zed', 'ada', 'bob'])
    expect(sortUsers([view(), view()]).map((u) => u.username)).toEqual(['ada', 'ada'])
  })
})

describe('emailStatus', () => {
  it('is none without an address, else confirmed or bounced', () => {
    expect(emailStatus(false, false)).toBe('none')
    expect(emailStatus(false, true)).toBe('none')
    expect(emailStatus(true, false)).toBe('confirmed')
    expect(emailStatus(true, true)).toBe('bounced')
  })
})
