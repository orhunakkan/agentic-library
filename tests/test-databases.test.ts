import { describe, expect, it } from 'vitest'
import { LOCAL_TEST_DATABASE_URL, testDatabaseUrl } from './test-databases'

const CI = 'postgres://postgres:postgres@postgres:5432/agentic_test'

describe('testDatabaseUrl', () => {
  it('is DATABASE_URL, or the local database when it is unset or empty', () => {
    expect(testDatabaseUrl({ DATABASE_URL: CI })).toBe(CI)
    expect(testDatabaseUrl({})).toBe(LOCAL_TEST_DATABASE_URL)
    expect(testDatabaseUrl({ DATABASE_URL: '' })).toBe(LOCAL_TEST_DATABASE_URL)
  })
})
