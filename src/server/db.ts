import '@tanstack/react-start/server-only'
import postgres, { type ISql, type Sql } from 'postgres'
import { getConfig } from './config.ts'

export type Db = ISql

export type Pool = Sql

export class DatabaseNotConfiguredError extends Error {
  name = 'DatabaseNotConfiguredError'
  constructor() {
    super('The database is not configured (DATABASE_URL is not set)')
  }
}

let client: Sql | undefined

export function isDatabaseConfigured(): boolean {
  return getConfig().databaseUrl !== null
}

export function getDb(): Sql {
  if (client) return client
  const url = getConfig().databaseUrl
  if (!url) throw new DatabaseNotConfiguredError()
  client = postgres(url, {
    max: 5,
    idle_timeout: 30,
    connect_timeout: 5,
    onnotice: () => {},
    connection: { application_name: 'agentic-library', statement_timeout: 5000 },
  })
  return client
}

export async function closeDb(): Promise<void> {
  const current = client
  client = undefined
  await current?.end({ timeout: 5 })
}
