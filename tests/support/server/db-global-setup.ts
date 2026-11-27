import postgres from 'postgres'
import { DATABASE_WORKERS, testDatabaseUrl, workerDatabaseUrl } from '../../test-databases.ts'

/**
 * Gives each database-test worker its own database, named after the test database with `_w<id>` before the `_test`
 * ending, and with a fresh, migrated schema, before any test file starts. A worker database is created, through the
 * test database, only when it doesn't exist yet: creating one costs Postgres a checkpoint, which takes seconds, so they
 * are kept between runs. They don't wait for the disk on commit, which a test database needs no protection from.
 */
export default async function migrateWorkerDatabases(): Promise<void> {
  /** `./db.ts` checks the `_test` name of the URL it's imported under, as it does in a worker. */
  const base = testDatabaseUrl()
  process.env.DATABASE_URL = base
  const { checkedTestDatabaseUrl, freshDatabase } = await import('./db.ts')
  const urls = Array.from({ length: DATABASE_WORKERS }, (_, i) =>
    checkedTestDatabaseUrl(workerDatabaseUrl(base, i + 1)),
  )
  const admin = postgres(base, { max: 1, onnotice: () => {} })
  try {
    const existing = new Set(
      (await admin<{ datname: string }[]>`select datname from pg_database`).map((r) => r.datname),
    )
    for (const name of urls.map((url) => new URL(url).pathname.slice(1))) {
      if (existing.has(name)) continue
      await admin`create database ${admin(name)}`
      await admin`alter database ${admin(name)} set synchronous_commit = off`
    }
  } finally {
    await admin.end()
  }
  await Promise.all(urls.map((url) => freshDatabase(url)))
}
