export const LOCAL_TEST_DATABASE_URL = 'postgres://postgres:postgres@127.0.0.1:5432/agentic_test'

const NAME = /\/([^/?#]*)(?=[?#]|$)/

export function databaseName(url: string): string {
  return NAME.exec(url.replace(/^[a-z]+:\/\/[^/]*/, ''))?.[1] ?? ''
}

export function withDatabase(url: string, name: string): string {
  const origin = /^[a-z]+:\/\/[^/]*/.exec(url)?.[0] ?? ''
  return origin + url.slice(origin.length).replace(NAME, `/${name}`)
}

export function testDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.DATABASE_URL || LOCAL_TEST_DATABASE_URL
}

export function e2eDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (env.E2E_DATABASE_URL) return env.E2E_DATABASE_URL
  const url = testDatabaseUrl(env)
  const name = databaseName(url)
  if (!name.endsWith('_test') || name.endsWith('_e2e_test')) return url
  return withDatabase(url, `${name.slice(0, -'_test'.length)}_e2e_test`)
}
