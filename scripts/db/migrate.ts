import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import postgres, { type TransactionSql } from 'postgres'

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../db/migrations/', import.meta.url))
const FILE_NAME = /^\d{4}_[a-z0-9_]+\.sql$/
const LOCK_ID = 0x61676e74

export interface MigrateOptions {
  url: string
  role?: string
  dir?: string
  log?: (message: string) => void
}

interface Migration {
  name: string
  sql: string
  checksum: string
}

export function readMigrations(dir = MIGRATIONS_DIR): Migration[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => {
      if (!FILE_NAME.test(name)) throw new Error(`Migration file name must look like 0001_description.sql: ${name}`)
      const sql = readFileSync(`${dir}/${name}`, 'utf8').replaceAll('\r\n', '\n')
      return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') }
    })
}

export async function migrate({ url, role, dir, log = () => {} }: MigrateOptions): Promise<string[]> {
  const migrations = readMigrations(dir)
  const sql = postgres(url, { max: 1, onnotice: () => {}, connection: { application_name: 'agentic-migrate' } })
  const asOwner = async (tx: TransactionSql) => {
    if (role) await tx`set local role ${tx(role)}`
  }
  try {
    await sql`select pg_advisory_lock(${LOCK_ID})`
    await sql.begin(async (tx) => {
      await asOwner(tx)
      await tx`
        create table if not exists schema_migrations (
          name text primary key,
          checksum text not null,
          applied_at timestamptz not null default now()
        )`
    })
    const rows = await sql<{ name: string; checksum: string }[]>`select name, checksum from schema_migrations`
    const applied = new Map(rows.map((r) => [r.name, r.checksum]))
    const checksums = new Map(migrations.map((m) => [m.name, m.checksum]))
    for (const [name, checksum] of applied) {
      if (!checksums.has(name)) throw new Error(`Applied migration ${name} is missing from ${dir ?? MIGRATIONS_DIR}`)
      if (checksums.get(name) !== checksum)
        throw new Error(`Applied migration ${name} has changed since it ran; add a new migration instead`)
    }
    const done: string[] = []
    for (const m of migrations) {
      if (applied.has(m.name)) continue
      log(`applying ${m.name}`)
      await sql.begin(async (tx) => {
        await asOwner(tx)
        await tx.unsafe(m.sql).simple()
        await tx`insert into schema_migrations (name, checksum) values (${m.name}, ${m.checksum})`
      })
      done.push(m.name)
    }
    log(done.length === 0 ? 'database is up to date' : `applied ${done.length} migration(s)`)
    return done
  } finally {
    await sql.end({ timeout: 5 })
  }
}

if (import.meta.main) {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('migrate: DATABASE_URL is not set')
    process.exit(1)
  }
  try {
    await migrate({ url, role: process.env.DB_OWNER_ROLE || undefined, log: (m) => console.log(`migrate: ${m}`) })
  } catch (error) {
    console.error(`migrate: ${(error as Error).message}`)
    process.exit(1)
  }
}
