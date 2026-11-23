import '@tanstack/react-start/server-only'
import type { Db } from '../db.ts'

export const KEEP_DAYS = 31

export interface UsageMinute {
  minute: Date
  characters: number
}

export async function usageSince(db: Db, userId: number, since: Date): Promise<UsageMinute[]> {
  return db<UsageMinute[]>`
    select minute, characters from speech_usage
    where user_id = ${userId} and minute >= date_trunc('minute', ${since}::timestamptz)
    order by minute`
}

export async function charactersSince(db: Db, userId: number, since: Date): Promise<number> {
  const [row] = await db<{ total: string | null }[]>`
    select sum(characters) as total from speech_usage
    where user_id = ${userId} and minute >= date_trunc('minute', ${since}::timestamptz)`
  return Number(row?.total ?? 0)
}

export async function recordUsage(db: Db, userId: number, characters: number, now = new Date()): Promise<void> {
  await db`
    with swept as (
      delete from speech_usage
      where user_id = ${userId} and minute < ${now}::timestamptz - make_interval(days => ${KEEP_DAYS})
    )
    insert into speech_usage (user_id, minute, characters, requests)
    values (${userId}, date_trunc('minute', ${now}::timestamptz), ${characters}, 1)
    on conflict (user_id, minute) do update set
      characters = speech_usage.characters + excluded.characters, requests = speech_usage.requests + 1`
}

export async function usageLast30Days(db: Db, userId: number, now = new Date()): Promise<number> {
  return charactersSince(db, userId, new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000))
}
