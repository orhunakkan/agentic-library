import { describe, expect, it, vi } from 'vitest'

vi.mock('~/server/config.ts', () => ({ getConfig: () => ({ databaseUrl: null }) }))

const { getDb, isDatabaseConfigured } = await import('~/server/db.ts')

describe('a server without DATABASE_URL', () => {
  it('says the database isn’t configured, and refuses to hand out a pool', () => {
    expect(isDatabaseConfigured()).toBe(false)
    expect(() => getDb()).toThrow(
      expect.objectContaining({
        name: 'DatabaseNotConfiguredError',
        message: 'The database is not configured (DATABASE_URL is not set)',
      }),
    )
  })
})
