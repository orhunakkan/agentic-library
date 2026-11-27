import postgres from 'postgres'
import { test as base } from 'vitest'
import { databaseUrl } from './db'

/**
 * The integration tests' shared setup. Each Vitest worker has a database of its own, migrated fresh once a run
 * (`db-global-setup.ts`, `db-worker.ts`); use this file's `it` (or `test`) in place of Vitest's, and every test starts
 * with every table empty. No test file names its own tables to truncate, so a new table can't be left off a list and
 * leak rows into the next test.
 */

/**
 * The file's connection to the test database, for helpers outside a test. The `sql` fixture hands tests the same client,
 * and closes it when the file is done.
 */
export const raw = postgres(databaseUrl, { max: 1, onnotice: () => {} })

/** The tables migrations keep their own records in, which a reset leaves alone. */
const KEPT_TABLES = ['schema_migrations']

/**
 * Empties every table in `public` but the migrations' own, and restarts their sequences. The list is read from
 * `pg_tables` each time, so a table added by a new migration is reset without anyone listing it.
 */
export async function resetTables(sql = raw): Promise<void> {
  const rows = await sql<{ tablename: string }[]>`
    select tablename from pg_tables where schemaname = 'public' and tablename <> all(${KEPT_TABLES})`
  if (rows.length === 0) return
  await sql`truncate ${sql(rows.map((row) => row.tablename))} restart identity cascade`
}

export const test = base
  // biome-ignore lint/correctness/noEmptyPattern: Vitest reads a fixture's first argument as a pattern to find what it uses
  .extend('sql', { scope: 'file' }, async ({}, { onCleanup }) => {
    onCleanup(() => raw.end())
    return raw
  })
  /** Runs before the file's own `beforeEach` hooks, so rows they add are kept. */
  .extend('reset', { auto: true }, async ({ sql }) => {
    await resetTables(sql)
  })

export { test as it }
