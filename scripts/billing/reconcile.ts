import { reconcileSubscriptions } from '../../src/server/billing/reconcile.ts'
import { getConfig } from '../../src/server/config.ts'
import { closeDb, getDb } from '../../src/server/db.ts'
import { describeError } from '../../src/server/redact.ts'

const billing = getConfig().billing
if (!billing) {
  console.error('Billing is off here: no PADDLE_ settings, so there is nothing to reconcile.')
  process.exit(1)
}
try {
  const counts = await reconcileSubscriptions(getDb(), billing)
  console.log(
    `Paddle lists ${counts.listed} subscription(s): ${counts.updated} updated, ${counts.unchanged} already current, ${counts.skipped} skipped.`,
  )
} catch (error) {
  console.error(`Reconcile failed: ${describeError(error).split('\n')[0]}`)
  process.exitCode = 1
} finally {
  await closeDb()
}
