import { describe, expect, it } from 'vitest'
import { databaseName, e2eDatabaseUrl, LOCAL_TEST_DATABASE_URL, testDatabaseUrl, withDatabase } from './test-databases'

const CI = 'postgres://postgres:postgres@postgres:5432/agentic_test'

describe('databaseName and withDatabase', () => {
  it('read and replace the name, keeping the host, the credentials and any query', () => {
    expect(databaseName(LOCAL_TEST_DATABASE_URL)).toBe('agentic_test')
    expect(databaseName('postgres://agentic_dev@/agentic_dev?host=/var/run/postgresql')).toBe('agentic_dev')
    expect(withDatabase(CI, 'postgres')).toBe('postgres://postgres:postgres@postgres:5432/postgres')
    expect(withDatabase('postgres://u@/a_test?host=/run/pg', 'b_test')).toBe('postgres://u@/b_test?host=/run/pg')
  })
})

describe('testDatabaseUrl', () => {
  it('is DATABASE_URL, or the local database when it is unset or empty', () => {
    expect(testDatabaseUrl({ DATABASE_URL: CI })).toBe(CI)
    expect(testDatabaseUrl({})).toBe(LOCAL_TEST_DATABASE_URL)
    expect(testDatabaseUrl({ DATABASE_URL: '' })).toBe(LOCAL_TEST_DATABASE_URL)
  })
})

describe('e2eDatabaseUrl', () => {
  it('is a database of its own beside the database tests’ one, locally and in CI', () => {
    expect(e2eDatabaseUrl({})).toBe('postgres://postgres:postgres@127.0.0.1:5432/agentic_e2e_test')
    expect(e2eDatabaseUrl({ DATABASE_URL: CI })).toBe('postgres://postgres:postgres@postgres:5432/agentic_e2e_test')
  })

  it('takes E2E_DATABASE_URL as it is, and leaves a name the server will refuse, or one already its own, alone', () => {
    expect(e2eDatabaseUrl({ E2E_DATABASE_URL: CI, DATABASE_URL: 'x' })).toBe(CI)
    const dev = 'postgres://postgres:postgres@127.0.0.1:5432/agentic_dev'
    expect(e2eDatabaseUrl({ DATABASE_URL: dev })).toBe(dev)
    const own = 'postgres://postgres:postgres@127.0.0.1:5432/agentic_e2e_test'
    expect(e2eDatabaseUrl({ DATABASE_URL: own })).toBe(own)
  })
})
