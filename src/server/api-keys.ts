import '@tanstack/react-start/server-only'
import { getConfig, type Kek } from './config.ts'
import { type Db, getDb } from './db.ts'
import { associatedData, open, seal } from './key-crypto.ts'

export type Provider = 'anthropic' | 'elevenlabs' | 'openai'
export const PROVIDERS: readonly Provider[] = ['anthropic', 'openai', 'elevenlabs']

export interface ApiKeyStatus {
  provider: Provider
  last4: string
  createdAt: Date
  lastUsedAt: Date | null
}

export async function getKeyStatuses(db: Db, userId: number): Promise<ApiKeyStatus[]> {
  const rows = await db<{ provider: Provider; last4: string; created_at: Date; last_used_at: Date | null }[]>`
    select provider, last4, created_at, last_used_at from api_keys where user_id = ${userId} order by provider`
  return rows.map((r) => ({
    provider: r.provider,
    last4: r.last4,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
  }))
}

export async function hasKey(db: Db, userId: number, provider: Provider): Promise<boolean> {
  return (await getKeyStatuses(db, userId)).some((k) => k.provider === provider)
}

function currentKek(): Kek {
  const kek = getConfig().kek
  if (!kek) throw new Error('No KEK is configured, so API keys cannot be stored or used')
  return kek
}

export async function saveKey(db: Db, userId: number, provider: Provider, key: string, kek = currentKek()) {
  const sealed = seal(key, kek, associatedData(userId, provider))
  await db`
    insert into api_keys (user_id, provider, ciphertext, iv, auth_tag, kek_id, last4, last_validated_at)
    values (${userId}, ${provider}, ${sealed.ciphertext}, ${sealed.iv}, ${sealed.authTag}, ${sealed.kekId},
      ${key.slice(-4)}, now())
    on conflict (user_id, provider) do update set
      ciphertext = excluded.ciphertext, iv = excluded.iv, auth_tag = excluded.auth_tag, kek_id = excluded.kek_id,
      last4 = excluded.last4, created_at = now(), last_used_at = null, last_validated_at = now()`
}

export async function deleteKey(db: Db, userId: number, provider: Provider): Promise<boolean> {
  const result = await db`delete from api_keys where user_id = ${userId} and provider = ${provider}`
  return result.count > 0
}

interface SealedRow {
  id: string
  user_id: string
  provider: Provider
  ciphertext: Buffer
  iv: Buffer
  auth_tag: Buffer
  kek_id: number
}

function decryptRow(row: SealedRow, keks: readonly Kek[]): string {
  const kek = keks.find((k) => k.id === row.kek_id)
  if (!kek) throw new Error(`API key ${row.id} was encrypted with an unknown KEK (id ${row.kek_id})`)
  return open(
    { ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag },
    kek,
    associatedData(row.user_id, row.provider),
  )
}

export async function withApiKey<T>(
  userId: number,
  provider: Provider,
  fn: (key: string) => Promise<T>,
  db: Db = getDb(),
): Promise<T> {
  const [row] = await db<SealedRow[]>`
    select id, user_id, provider, ciphertext, iv, auth_tag, kek_id
    from api_keys where user_id = ${userId} and provider = ${provider}`
  if (!row) throw new Error(`No ${provider} API key saved for this account`)
  const { kek, kekPrevious } = getConfig()
  const key = decryptRow(
    row,
    [kek, kekPrevious].filter((k) => k !== null),
  )
  const result = await fn(key)
  await db`update api_keys set last_used_at = now() where id = ${row.id}`
  return result
}

export async function rotateKeys(db: Db, current: Kek, previous: Kek | null) {
  const rows = await db<SealedRow[]>`
    select id, user_id, provider, ciphertext, iv, auth_tag, kek_id from api_keys where kek_id <> ${current.id}`
  let rotated = 0
  let unreadable = 0
  for (const row of rows) {
    if (!previous || row.kek_id !== previous.id) {
      unreadable++
      continue
    }
    const sealed = seal(decryptRow(row, [previous]), current, associatedData(row.user_id, row.provider))
    await db`
      update api_keys set ciphertext = ${sealed.ciphertext}, iv = ${sealed.iv}, auth_tag = ${sealed.authTag},
        kek_id = ${sealed.kekId}
      where id = ${row.id} and kek_id = ${row.kek_id}`
    rotated++
  }
  return { rotated, unreadable }
}
