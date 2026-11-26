import { workerDatabaseUrl } from '../../../tests/test-databases.ts'

/**
 * Runs in each database-test worker before its files load: points the worker, and so the app's own client, at the
 * worker's own database, so files in different workers never see each other's rows.
 */
const poolId = process.env.VITEST_POOL_ID
const url = process.env.DATABASE_URL
if (!poolId || !url) throw new Error('A database test worker needs VITEST_POOL_ID and DATABASE_URL')
process.env.DATABASE_URL = workerDatabaseUrl(url, poolId)
