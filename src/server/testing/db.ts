import { randomBytes } from 'node:crypto'
import postgres from 'postgres'
import { migrate } from '../../../scripts/db/migrate'

function testDatabaseUrl(): string {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set; the database tests need a PostgreSQL database named *_test')
  const name = new URL(url.replace(/^postgres(ql)?:/, 'http:')).pathname.slice(1)
  if (!name.endsWith('_test'))
    throw new Error(`Refusing to run database tests against "${name}": its name must end in _test`)
  return url
}

const url = testDatabaseUrl()
process.env.KEK ??= randomBytes(32).toString('base64')

export async function freshDatabase(): Promise<void> {
  const sql = postgres(url, { max: 1, onnotice: () => {} })
  try {
    await sql.unsafe('drop schema public cascade; create schema public').simple()
  } finally {
    await sql.end()
  }
  await migrate({ url })
}

export { url as databaseUrl }
