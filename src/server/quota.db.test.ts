import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '~/server/db'
import { take } from '~/server/quota'
import { ASK_LIMIT, SPEECH_LIMIT } from '~/server/rate-limit'
import { databaseUrl, freshDatabase } from './testing/db'
import { testUser } from './testing/users'

const raw = postgres(databaseUrl, { max: 1, onnotice: () => {} })
const db = () => getDb()

beforeAll(freshDatabase)
afterAll(async () => {
  await raw.end()
  await closeDb()
})
beforeEach(async () => {
  await raw`truncate users, audit_events, speech_usage restart identity cascade`
})

const T0 = new Date('2026-11-23T12:00:00Z')
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000)

let users = 0
const reader = () => testUser(db(), `reader-${++users}`, '$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA')

describe('take', () => {
  it('takes units up to the limit, then names when the oldest frees up', async () => {
    const { id } = await reader()
    for (let i = 0; i < ASK_LIMIT.max; i++) expect((await take(db(), id, 'ask', { now: at(i / 10) })).ok).toBe(true)
    expect(await take(db(), id, 'ask', { now: at(10) })).toEqual({ ok: false, retryAt: at(60) })
    expect((await take(db(), id, 'ask', { now: at(60) })).ok).toBe(true)
  })

  it('lets exactly one of two parallel takes have the last unit', async () => {
    const { id } = await reader()
    for (let i = 0; i < ASK_LIMIT.max - 1; i++) await take(db(), id, 'ask', { now: at(0) })
    const both = await Promise.all([take(db(), id, 'ask', { now: at(1) }), take(db(), id, 'ask', { now: at(1) })])
    expect(both.map((t) => t.ok).sort()).toEqual([false, true])
  })
})

describe('settling a reservation', () => {
  it('adds the outcome to the reserved event', async () => {
    const { id } = await reader()
    const taken = await take(db(), id, 'ask', { now: at(0), ip: '203.0.113.9', detail: { book: 'emma' } })
    if (!taken.ok) throw new Error('expected a unit')
    await taken.settle({ outputTokens: 12 })
    expect(await raw`select event, host(ip) as ip, detail from audit_events`).toEqual([
      { event: 'book.asked', ip: '203.0.113.9', detail: { book: 'emma', outputTokens: 12 } },
    ])
  })

  it('can name the outcome as another event the kind counts', async () => {
    const { id } = await reader()
    const taken = await take(db(), id, 'api-key', { as: 'api_key.saved' })
    if (!taken.ok) throw new Error('expected a unit')
    await taken.settle({ provider: 'anthropic' }, 'api_key.rejected')
    expect(await raw`select event, detail from audit_events`).toEqual([
      { event: 'api_key.rejected', detail: { provider: 'anthropic' } },
    ])
  })

  it('counts every event a kind names', async () => {
    const { id } = await reader()
    await raw`
      insert into audit_events (user_id, event, at)
      select ${id}, e, ${at(0)}
      from unnest(array['api_key.saved', 'api_key.deleted', 'api_key.rejected']) e, generate_series(1, 3)`
    expect((await take(db(), id, 'api-key', { as: 'api_key.deleted', now: at(1) })).ok).toBe(true)
    expect(await take(db(), id, 'api-key', { as: 'api_key.saved', now: at(1) })).toEqual({ ok: false, retryAt: at(60) })
  })
})

describe('speech takes characters', () => {
  it('takes the characters asked for, and refuses what would go over the limit', async () => {
    const { id } = await reader()
    expect((await take(db(), id, 'speech', { amount: SPEECH_LIMIT.max - 10, now: at(0) })).ok).toBe(true)
    expect((await take(db(), id, 'speech', { amount: 10, now: at(1) })).ok).toBe(true)
    expect(await take(db(), id, 'speech', { amount: 1, now: at(2) })).toEqual({ ok: false, retryAt: at(61) })
  })

  it('lets only one of two parallel takes have the last characters', async () => {
    const { id } = await reader()
    await take(db(), id, 'speech', { amount: SPEECH_LIMIT.max - 100, now: at(0) })
    const both = await Promise.all([
      take(db(), id, 'speech', { amount: 100, now: at(1) }),
      take(db(), id, 'speech', { amount: 100, now: at(1) }),
    ])
    expect(both.map((t) => t.ok).sort()).toEqual([false, true])
  })
})
