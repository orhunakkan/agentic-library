import { describe, expect, it } from 'vitest'
import { LOCAL_TEST_DATABASE_URL, testDatabaseUrl, workerDatabaseUrl } from './test-databases'

const GIVEN = 'postgres://postgres:postgres@postgres:5432/agentic_test'

describe('testDatabaseUrl', () => {
  it('is DATABASE_URL, or the local database when it is unset or empty', () => {
    expect(testDatabaseUrl({ DATABASE_URL: GIVEN })).toBe(GIVEN)
    expect(testDatabaseUrl({})).toBe(LOCAL_TEST_DATABASE_URL)
    expect(testDatabaseUrl({ DATABASE_URL: '' })).toBe(LOCAL_TEST_DATABASE_URL)
  })
})

describe('workerDatabaseUrl', () => {
  it('puts the worker before the _test ending, and keeps the rest of the URL', () => {
    expect(workerDatabaseUrl(GIVEN, 3)).toBe('postgres://postgres:postgres@postgres:5432/agentic_w3_test')
    expect(workerDatabaseUrl(`${LOCAL_TEST_DATABASE_URL}?sslmode=disable`, '12')).toBe(
      'postgres://postgres:postgres@127.0.0.1:5432/agentic_w12_test?sslmode=disable',
    )
  })

  it('refuses a database not named *_test, so none is made beside a real one', () => {
    expect(() => workerDatabaseUrl('postgres://postgres:postgres@db:5432/agentic', 1)).toThrow(/must end in _test/)
  })
})
