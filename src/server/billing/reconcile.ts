import '@tanstack/react-start/server-only'
import { isObject } from '../../shared/lib/json-shape.ts'
import type { BillingConfig } from '../config.ts'
import type { Pool } from '../db.ts'
import { listSubscriptions, type PaddleOptions } from './paddle-api.ts'
import { recordStatusChange, upsertFromPaddle } from './store.ts'
import { subscriptionRow } from './webhook-input.ts'

export interface ReconcileCounts {
  listed: number
  updated: number
  unchanged: number
  skipped: number
}

export async function reconcileSubscriptions(
  pool: Pool,
  billing: BillingConfig,
  options: Pick<PaddleOptions, 'fetch'> = {},
): Promise<ReconcileCounts> {
  const entities = await listSubscriptions({ ...options, config: billing })
  const counts: ReconcileCounts = { listed: entities.length, updated: 0, unchanged: 0, skipped: 0 }
  for (const entity of entities) {
    const updatedAt = isObject(entity) && typeof entity.updated_at === 'string' ? new Date(entity.updated_at) : null
    if (!updatedAt || Number.isNaN(updatedAt.getTime())) {
      counts.skipped++
      continue
    }
    const mapped = subscriptionRow(entity, billing.prices, updatedAt)
    if (!mapped.ok) {
      counts.skipped++
      continue
    }
    const applied = await pool.begin(async (tx) => {
      const result = await upsertFromPaddle(tx, mapped.row)
      await recordStatusChange(tx, result, mapped.row.id, 'reconcile')
      return result.applied
    })
    if (applied) counts.updated++
    else counts.unchanged++
  }
  return counts
}
