import { describe, expect, it } from 'vitest'
import { toInviteView } from '~/server/signup/view'

describe('toInviteView', () => {
  it('gives the page what it shows and nothing else', () => {
    const row = {
      id: '0b9d1f2e-3c4a-4b5c-8d6e-7f8091a2b3c4',
      note: 'for Ann',
      by: 'orhun',
      createdAt: new Date('2026-11-06T10:00:00Z'),
      expiresAt: new Date('2026-11-13T10:00:00Z'),
      tokenHash: Buffer.from('secret'),
      attempts: 3,
    }
    const view = toInviteView(row)
    expect(Object.keys(view).sort()).toEqual(['by', 'createdAt', 'expiresAt', 'id', 'note'])
    expect(view).toEqual({
      id: row.id,
      note: 'for Ann',
      by: 'orhun',
      createdAt: '2026-11-06T10:00:00.000Z',
      expiresAt: '2026-11-13T10:00:00.000Z',
    })
  })
})
