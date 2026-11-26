export const LOCAL_TEST_DATABASE_URL = 'postgres://postgres:postgres@127.0.0.1:5432/agentic_test'

/**
 * How many database test files run at once, each in its own database. Each holds up to about six connections (the
 * app's pool of five and the test's own), so this stays well inside Postgres's default of 100.
 */
export const DATABASE_WORKERS = 8

export function testDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.DATABASE_URL || LOCAL_TEST_DATABASE_URL
}

/**
 * The database that one Vitest worker uses: the test database's name with `_w<id>` put before its `_test` ending. It
 * refuses a database not named `*_test`, so no worker database is ever made beside a real one.
 */
export function workerDatabaseUrl(url: string, poolId: string | number): string {
  const parsed = new URL(url)
  const name = parsed.pathname.slice(1)
  if (!name.endsWith('_test'))
    throw new Error(`Refusing to run database tests against "${name}": its name must end in _test`)
  parsed.pathname = `/${name.slice(0, -'_test'.length)}_w${poolId}_test`
  return parsed.toString()
}
