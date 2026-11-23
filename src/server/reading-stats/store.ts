import '@tanstack/react-start/server-only'
import { MAX_SESSIONS_PER_DAY } from '~/shared/reading-stats/contract'
import type { Day } from '~/shared/reading-stats/days'
import type { GoalChange } from '~/shared/reading-stats/goals'
import type { TimeWrite } from '~/shared/sync/sync'
import { onBook, ownedBook } from '../book-ref/book.ts'
import { type BookRef, bookOf } from '../book-ref/ref.ts'
import type { Db, Pool } from '../db.ts'

const keepZone = (db: Db, userId: number, zone: string) =>
  db`update users set time_zone = ${zone} where id = ${userId} and time_zone is distinct from ${zone}`

export async function saveTime(
  pool: Pool,
  userId: number,
  items: readonly Pick<TimeWrite, 'id' | 'kind' | 'day' | 'seconds'>[],
  zone: string | null,
): Promise<number> {
  return pool.begin(async (tx) => {
    if (zone !== null) await keepZone(tx, userId, zone)
    let skipped = 0
    for (const item of items) {
      const saved = await tx`
        insert into reading_time (user_id, id, kind, day, seconds)
        select ${userId}::bigint, ${item.id}::uuid, ${item.kind}::text, ${item.day}::date, ${item.seconds}::int
        where (select count(*) from reading_time where user_id = ${userId} and day = ${item.day}::date)
            < ${MAX_SESSIONS_PER_DAY}
          or exists (select 1 from reading_time where user_id = ${userId} and id = ${item.id}::uuid)
        on conflict (user_id, id) do update
          set seconds = greatest(reading_time.seconds, excluded.seconds), updated_at = now()
          where reading_time.day = excluded.day and reading_time.kind = excluded.kind
        returning 1`
      if (saved.length === 0) skipped++
    }
    return skipped
  })
}

export interface DayTotal {
  day: Day
  kind: 'reading' | 'listening'
  seconds: number
}

export async function dayTotals(db: Db, userId: number): Promise<DayTotal[]> {
  const rows = await db<{ day: string; kind: DayTotal['kind']; seconds: string }[]>`
    select day::text as day, kind, sum(seconds) as seconds from reading_time
    where user_id = ${userId} group by day, kind`
  return rows.map((r) => ({ day: r.day, kind: r.kind, seconds: Number(r.seconds) }))
}

export async function goalHistory(db: Db, userId: number): Promise<GoalChange[]> {
  const rows = await db<{ from_day: string; minutes: number }[]>`
    select from_day::text as from_day, minutes from reading_goals where user_id = ${userId} order by from_day`
  return rows.map((r) => ({ fromDay: r.from_day, minutes: r.minutes }))
}

export async function setGoal(pool: Pool, userId: number, fromDay: Day, minutes: number, zone: string): Promise<void> {
  await pool.begin(async (tx) => {
    await keepZone(tx, userId, zone)
    await tx`
      insert into reading_goals (user_id, from_day, minutes) values (${userId}, ${fromDay}::date, ${minutes})
      on conflict (user_id, from_day) do update set minutes = excluded.minutes, set_at = now()`
  })
}

export async function timeZoneOf(db: Db, userId: number): Promise<string | null> {
  const [row] = await db<{ time_zone: string | null }[]>`select time_zone from users where id = ${userId}`
  return row?.time_zone ?? null
}

export async function markFinished(db: Db, userId: number, ref: BookRef): Promise<'added' | 'exists' | 'missing'> {
  const conflict =
    ref.userBookId === null
      ? db`(user_id, book_slug) where book_slug is not null`
      : db`(user_id, user_book_id) where user_book_id is not null`
  const added = await db`
    insert into finished_books (user_id, book_slug, user_book_id)
    select ${userId}::bigint, ${ref.slug}::text, ${ref.userBookId}::uuid
    where ${ownedBook(db, userId, ref)}
    on conflict ${conflict} do nothing
    returning 1`
  if (added.length) return 'added'
  const there = await db`select 1 from finished_books where user_id = ${userId} and ${onBook(db, ref)}`
  return there.length ? 'exists' : 'missing'
}

export async function unmarkFinished(db: Db, userId: number, ref: BookRef): Promise<boolean> {
  const gone = await db`delete from finished_books where user_id = ${userId} and ${onBook(db, ref)} returning 1`
  return gone.length > 0
}

export interface FinishedRow {
  ref: BookRef
  finishedAt: Date
}

export async function listFinished(db: Db, userId: number): Promise<FinishedRow[]> {
  const rows = await db<{ book_slug: string | null; user_book_id: string | null; finished_at: Date }[]>`
    select book_slug, user_book_id, finished_at from finished_books
    where user_id = ${userId}
    order by finished_at desc, id`
  return rows.map((r) => ({ ref: bookOf(r), finishedAt: r.finished_at }))
}
