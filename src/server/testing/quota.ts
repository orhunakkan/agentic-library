import type { Pool } from '../db.ts'
import { type EventTakeKind, take } from '../quota.ts'

/** Spends `count` units of a usage quota the way the app does, at `now` (default: now). */
export async function spend(pool: Pool, userId: number, kind: EventTakeKind, count: number, now?: Date): Promise<void> {
  for (let i = 0; i < count; i++) {
    const taken = await take(pool, userId, kind, { now })
    if (!taken.ok) throw new Error(`the ${kind} quota ran out after ${i} units`)
  }
}
