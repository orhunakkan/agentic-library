import { randomBytes } from 'node:crypto'
import postgres from 'postgres'
import { migrate } from '../../../scripts/db/migrate'

/** `url`, if it names a PostgreSQL database whose name ends in `_test`; the database tests refuse any other. */
export function checkedTestDatabaseUrl(url: string | undefined): string {
  if (!url) throw new Error('DATABASE_URL is not set; the database tests need a PostgreSQL database named *_test')
  const name = new URL(url.replace(/^postgres(ql)?:/, 'http:')).pathname.slice(1)
  if (!name.endsWith('_test'))
    throw new Error(`Refusing to run database tests against "${name}": its name must end in _test`)
  return url
}

const url = checkedTestDatabaseUrl(process.env.DATABASE_URL)
process.env.KEK ??= randomBytes(32).toString('base64')

/** Drops the database's `public` schema and migrates a new one: this worker's own database, unless told another. */
export async function freshDatabase(target = url): Promise<void> {
  const sql = postgres(checkedTestDatabaseUrl(target), { max: 1, onnotice: () => {} })
  try {
    await sql.unsafe('drop schema public cascade; create schema public').simple()
  } finally {
    await sql.end()
  }
  await migrate({ url: target })
}

export { url as databaseUrl }
