import { describe, expect, it } from 'vitest'
import { toAccessTokenView } from './view'

const row = {
  id: '0b6d5c3e-9f1a-4c2b-8d7e-6a5b4c3d2e1f',
  name: 'API tests',
  createdAt: new Date('2026-11-18T09:00:00Z'),
  lastUsedAt: null,
  expiresAt: new Date('2026-11-19T09:00:00Z'),
}

describe('toAccessTokenView', () => {
  it('has the id, the name, ISO times and whether it is the request’s token, and nothing else', () => {
    expect(toAccessTokenView(row)).toEqual({
      id: row.id,
      name: 'API tests',
      createdAt: '2026-11-18T09:00:00.000Z',
      lastUsedAt: null,
      expiresAt: '2026-11-19T09:00:00.000Z',
      current: false,
    })
    const used = toAccessTokenView({ ...row, lastUsedAt: new Date('2026-11-18T10:00:00Z') }, row.id)
    expect(used.lastUsedAt).toBe('2026-11-18T10:00:00.000Z')
    expect(used.current).toBe(true)
  })
})
