import '@tanstack/react-start/server-only'
import type { Db } from './db.ts'
import { blockedUntil, IP_LIMIT, type Limit, lookback, USERNAME_LIMIT } from './rate-limit.ts'

const since = (limit: Limit, now: Date) => new Date(now.getTime() - lookback(limit))
const normalize = (username: string) => username.toLowerCase().slice(0, 64)

export interface Attempt {
  id: string
}

export async function beginAttempt(
  db: Db,
  { username, ip }: { username: string; ip: string | null },
): Promise<Attempt> {
  const [row] = await db<{ id: string }[]>`
    insert into login_attempts (username, ip, succeeded) values (${normalize(username)}, ${ip}, false) returning id`
  if (!row) throw new Error('insert returned no row')
  return { id: row.id }
}

export async function markSucceeded(db: Db, attempt: Attempt): Promise<void> {
  await db`update login_attempts set succeeded = true where id = ${attempt.id}`
}

export async function discardAttempt(db: Db, attempt: Attempt): Promise<void> {
  await db`delete from login_attempts where id = ${attempt.id}`
}

export async function recordAttempt(
  db: Db,
  { username, ip, succeeded }: { username: string; ip: string | null; succeeded: boolean },
): Promise<void> {
  await db`insert into login_attempts (username, ip, succeeded) values (${normalize(username)}, ${ip}, ${succeeded})`
}

export async function usernameLockedUntil(
  db: Db,
  username: string,
  before?: Attempt,
  now = new Date(),
): Promise<Date | null> {
  const name = normalize(username)
  const beforeId = before?.id ?? null
  const rows = await db<{ at: Date }[]>`
    select at from login_attempts
    where username = ${name} and not succeeded and at > ${since(USERNAME_LIMIT, now)}::timestamptz
      and (${beforeId}::bigint is null or id < ${beforeId}::bigint)
      and at > coalesce(
        (select max(at) from login_attempts
          where username = ${name} and succeeded and (${beforeId}::bigint is null or id < ${beforeId}::bigint)),
        '-infinity'::timestamptz)`
  return blockedUntil(
    rows.map((r) => r.at),
    USERNAME_LIMIT,
    now,
  )
}

export async function ipBlockedUntil(
  db: Db,
  ip: string | null,
  before?: Attempt,
  now = new Date(),
): Promise<Date | null> {
  if (!ip) return null
  const beforeId = before?.id ?? null
  const rows = await db<{ at: Date }[]>`
    select at from login_attempts
    where ip = ${ip}::inet and not succeeded and at > ${since(IP_LIMIT, now)}::timestamptz
      and (${beforeId}::bigint is null or id < ${beforeId}::bigint)`
  return blockedUntil(
    rows.map((r) => r.at),
    IP_LIMIT,
    now,
  )
}

export async function clearFailures(db: Db, username: string): Promise<number> {
  const result = await db`delete from login_attempts where username = ${normalize(username)} and not succeeded`
  return result.count
}

export async function sweepAttempts(db: Db): Promise<void> {
  await db`delete from login_attempts where at < now() - interval '30 days'`
}
