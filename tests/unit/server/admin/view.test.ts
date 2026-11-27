import { describe, expect, it } from 'vitest'
import type { AdminUserRow } from '~/server/admin/store'
import { toAdminUserView, toAdminUserViews } from '~/server/admin/view'

const row = (over: Partial<AdminUserRow> = {}): AdminUserRow => ({
  id: 7,
  username: 'ada',
  role: 'member',
  createdAt: new Date('2026-11-06T12:00:00Z'),
  passwordChangedAt: new Date('2026-11-06T12:00:00Z'),
  disabledAt: null,
  lastActiveAt: null,
  sessions: 0,
  hasKey: false,
  email: 'none',
  lockedUntil: null,
  you: false,
  ...over,
})

describe('toAdminUserView', () => {
  it('turns times into ISO strings and leaves the id behind', () => {
    const view = toAdminUserView(row({ lastActiveAt: new Date('2026-11-06T13:00:00Z'), sessions: 2, hasKey: true }))
    expect(view).toEqual({
      username: 'ada',
      role: 'member',
      status: 'active',
      lockedUntil: null,
      createdAt: '2026-11-06T12:00:00.000Z',
      lastActiveAt: '2026-11-06T13:00:00.000Z',
      sessions: 2,
      hasKey: true,
      email: 'none',
      you: false,
    })
  })

  it('says locked while there is a lock, and disabled over locked', () => {
    const lock = new Date('2026-11-06T12:15:00Z')
    expect(toAdminUserView(row({ lockedUntil: lock }))).toMatchObject({
      status: 'locked',
      lockedUntil: '2026-11-06T12:15:00.000Z',
    })
    expect(toAdminUserView(row({ lockedUntil: lock, disabledAt: lock })).status).toBe('disabled')
    expect(toAdminUserViews([row(), row({ username: 'bob', you: true })]).map((v) => v.you)).toEqual([false, true])
  })

  it('carries the email status, never an address', () => {
    expect(toAdminUserView(row({ email: 'bounced' })).email).toBe('bounced')
    expect(JSON.stringify(toAdminUserView(row({ email: 'confirmed' })))).not.toContain('@')
  })
})
