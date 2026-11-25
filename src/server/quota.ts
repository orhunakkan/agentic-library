import '@tanstack/react-start/server-only'
import type { AuditEvent } from './audit.ts'
import type { Db, Pool } from './db.ts'
import {
  API_KEY_LIMIT,
  ARTICLE_SAVE_LIMIT,
  ASK_LIMIT,
  charactersRetryAt,
  EXPORT_LIMIT,
  IMPORT_LIMIT,
  type Limit,
  LOOKUP_LIMIT,
  nextAllowedAt,
  REPO_ADD_LIMIT,
  REPO_REFRESH_LIMIT,
  SPEECH_LIMIT,
  TRANSLATE_LIMIT,
  WORD_LOOKUP_LIMIT,
} from './rate-limit.ts'
import { recordUsage, usageSince } from './speech/store.ts'

interface EventQuota {
  limit: Limit
  /** The audit events that spend this quota; a reservation is written as the first unless told otherwise. */
  events: readonly [AuditEvent, ...AuditEvent[]]
}

/** Quotas whose units are audit events, one event per unit. */
const EVENT_QUOTAS = {
  ask: { limit: ASK_LIMIT, events: ['book.asked'] },
  'word-lookup': { limit: WORD_LOOKUP_LIMIT, events: ['word.looked_up'] },
  translate: { limit: TRANSLATE_LIMIT, events: ['word.translated'] },
  'book-lookup': { limit: LOOKUP_LIMIT, events: ['book.looked_up'] },
  'repo-add': { limit: REPO_ADD_LIMIT, events: ['repo.added'] },
  'repo-refresh': { limit: REPO_REFRESH_LIMIT, events: ['repo.refreshed'] },
  export: { limit: EXPORT_LIMIT, events: ['account.exported'] },
  'api-key': { limit: API_KEY_LIMIT, events: ['api_key.saved', 'api_key.deleted', 'api_key.rejected'] },
  import: { limit: IMPORT_LIMIT, events: ['book.imported'] },
  'article-save': { limit: ARTICLE_SAVE_LIMIT, events: ['article.saved'] },
} satisfies Record<string, EventQuota>

type EventKind = keyof typeof EVENT_QUOTAS

/** Imports are counted when they finish, so their callers only check, under their own lock. */
type CheckedKind = 'import' | 'article-save'

/** The kinds a request takes one reserved event of; imports only check. */
export type EventTakeKind = Exclude<EventKind, CheckedKind>

export interface TakeOptions {
  now?: Date
  ip?: string | null
  /** What is known before the call; the reservation starts with it. */
  detail?: object
  /** For a kind with several events, which one the reservation is written as. */
  as?: AuditEvent
}

export type Refused = { ok: false; retryAt: Date }

export type Taken =
  | {
      ok: true
      /** Adds the outcome to the reservation's detail, optionally renaming it to another event the kind counts. */
      settle: (detail: object, event?: AuditEvent) => Promise<void>
    }
  | Refused

async function eventRetryAt(db: Db, userId: number, kind: EventKind, now: Date): Promise<Date | null> {
  const { limit, events } = EVENT_QUOTAS[kind] as EventQuota
  const rows = await db<{ at: Date }[]>`
    select at from audit_events
    where user_id = ${userId} and event = any(${[...events]}::text[])
      and at > ${new Date(now.getTime() - limit.windowMs)}::timestamptz`
  return nextAllowedAt(
    rows.map((r) => r.at),
    limit,
    now,
  )
}

/** Checks and spends in one transaction, with the user row locked, so parallel takes queue behind each other. */
function locked<T>(pool: Pool, userId: number, spend: (tx: Db) => Promise<T>): Promise<T> {
  return pool.begin(async (tx) => {
    await tx`select id from users where id = ${userId} for update`
    return spend(tx)
  }) as Promise<T>
}

/**
 * Takes a unit of `kind` for the user before it is spent: with the user row locked, it checks the
 * limit and writes the reservation in one transaction, so parallel requests can't all pass the check.
 * A reservation counts whatever the outcome; the caller settles it with the outcome afterwards.
 * Speech takes `amount` read-aloud characters into its usage table, and has nothing to settle.
 */
export function take(
  pool: Pool,
  userId: number,
  kind: 'speech',
  options: { amount: number; now?: Date },
): Promise<{ ok: true } | Refused>
export function take(pool: Pool, userId: number, kind: EventTakeKind, options?: TakeOptions): Promise<Taken>
export function take(
  pool: Pool,
  userId: number,
  kind: EventTakeKind | 'speech',
  options: TakeOptions & { amount?: number } = {},
): Promise<Taken | { ok: true } | Refused> {
  const now = options.now ?? new Date()
  if (kind === 'speech') {
    /** The speech overload makes amount required. */
    const { amount } = options as { amount: number }
    return locked(pool, userId, async (tx): Promise<{ ok: true } | Refused> => {
      const minutes = await usageSince(tx, userId, new Date(now.getTime() - SPEECH_LIMIT.windowMs))
      const retryAt = charactersRetryAt(minutes, amount, SPEECH_LIMIT, now)
      if (retryAt) return { ok: false, retryAt }
      await recordUsage(tx, userId, amount, now)
      return { ok: true }
    })
  }
  const { ip = null, detail = {}, as } = options
  return locked(pool, userId, async (tx): Promise<Taken> => {
    const retryAt = await eventRetryAt(tx, userId, kind, now)
    if (retryAt) return { ok: false, retryAt }
    /** An insert with returning yields exactly its one row. */
    const [{ id }] = await tx<[{ id: string }]>`
      insert into audit_events (user_id, event, ip, detail, at)
      values (${userId}, ${as ?? EVENT_QUOTAS[kind].events[0]}, ${ip}, ${tx.json(detail as never)}, ${now})
      returning id`
    return {
      ok: true,
      settle: async (outcome, event) => {
        await pool`
          update audit_events set detail = detail || ${pool.json(outcome as never)}, event = coalesce(${event ?? null}, event)
          where id = ${id}`
      },
    }
  })
}

/**
 * When the user may next spend `kind`, without taking a unit. For imports, whose unit is recorded
 * when the import finishes: the caller must already hold the user row's lock in `tx`.
 */
export function retryAtLocked(tx: Db, userId: number, kind: CheckedKind, now: Date): Promise<Date | null> {
  return eventRetryAt(tx, userId, kind, now)
}
