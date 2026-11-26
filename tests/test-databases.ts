export const LOCAL_TEST_DATABASE_URL = 'postgres://postgres:postgres@127.0.0.1:5432/agentic_test'

export function testDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.DATABASE_URL || LOCAL_TEST_DATABASE_URL
}
