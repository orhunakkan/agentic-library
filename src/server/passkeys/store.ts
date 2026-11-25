import '@tanstack/react-start/server-only'
import { createHash, randomBytes } from 'node:crypto'
import { CHALLENGE_TTL_MS, isTransport, MAX_PASSKEYS, type Transport } from '../../shared/passkeys/passkeys.ts'
import { recordEvent } from '../audit.ts'
import type { Db, Pool } from '../db.ts'

export interface PasskeyRow {
  id: string
  credentialId: Buffer
  publicKey: Buffer
  signCount: number
  transports: Transport[]
  backedUp: boolean
  name: string
  createdAt: Date
  lastUsedAt: Date | null
}

interface Raw {
  id: string
  credential_id: Buffer
  public_key: Buffer
  sign_count: string
  transports: string[]
  backed_up: boolean
  name: string
  created_at: Date
  last_used_at: Date | null
}

const COLUMNS = 'id, credential_id, public_key, sign_count, transports, backed_up, name, created_at, last_used_at'

const toRow = (passkey: Raw): PasskeyRow => ({
  id: passkey.id,
  credentialId: passkey.credential_id,
  publicKey: passkey.public_key,
  signCount: Number(passkey.sign_count),
  transports: passkey.transports.filter(isTransport),
  backedUp: passkey.backed_up,
  name: passkey.name,
  createdAt: passkey.created_at,
  lastUsedAt: passkey.last_used_at,
})

export async function listPasskeys(db: Db, userId: number): Promise<PasskeyRow[]> {
  const rows = await db<Raw[]>`
    select ${db.unsafe(COLUMNS)} from passkeys where user_id = ${userId} order by created_at desc, id`
  return rows.map(toRow)
}

export async function countPasskeys(db: Db, userId: number): Promise<number> {
  const [row] = await db<{ count: string }[]>`select count(*) from passkeys where user_id = ${userId}`
  return Number(row?.count ?? 0)
}

export async function userHandle(db: Db, userId: number): Promise<Buffer> {
  const [row] = await db<{ webauthn_user_id: Buffer }[]>`
    update users set webauthn_user_id = coalesce(webauthn_user_id, ${randomBytes(32)})
    where id = ${userId} returning webauthn_user_id`
  if (!row) throw new Error('no such user')
  return row.webauthn_user_id
}

export interface NewPasskey {
  credentialId: Buffer
  publicKey: Buffer
  signCount: number
  transports: Transport[]
  backedUp: boolean
  name: string
}

export function addPasskey(pool: Pool, userId: number, passkey: NewPasskey): Promise<PasskeyRow | 'quota' | 'taken'> {
  return pool.begin(async (tx): Promise<PasskeyRow | 'quota' | 'taken'> => {
    await tx`select id from users where id = ${userId} for update`
    if ((await countPasskeys(tx, userId)) >= MAX_PASSKEYS) return 'quota'
    const [created] = await tx<Raw[]>`
      insert into passkeys (user_id, credential_id, public_key, sign_count, transports, backed_up, name)
      values (${userId}, ${passkey.credentialId}, ${passkey.publicKey}, ${passkey.signCount}, ${passkey.transports},
        ${passkey.backedUp}, ${passkey.name})
      on conflict (credential_id) do nothing
      returning ${tx.unsafe(COLUMNS)}`
    return created ? toRow(created) : 'taken'
  })
}

export async function removePasskey(db: Db, userId: number, id: string): Promise<boolean> {
  const result = await db`delete from passkeys where id = ${id} and user_id = ${userId}`
  return result.count > 0
}

export async function removePasskeysForReset(
  db: Db,
  userId: number,
  { ip = null, detail }: { ip?: string | null; detail: Record<string, unknown> },
): Promise<number> {
  const { count } = await db`delete from passkeys where user_id = ${userId}`
  if (count > 0) await recordEvent(db, 'passkey.removed', { userId, ip, detail: { ...detail, count } })
  return count
}

export interface SignInCandidate extends PasskeyRow {
  userId: number
  username: string
  userHandle: Buffer | null
  disabled: boolean
}

export async function findByCredentialId(db: Db, credentialId: Buffer): Promise<SignInCandidate | null> {
  const [row] = await db<
    (Raw & { user_id: string; username: string; webauthn_user_id: Buffer | null; disabled: boolean })[]
  >`
    select p.id, p.credential_id, p.public_key, p.sign_count, p.transports, p.backed_up, p.name, p.created_at,
      p.last_used_at, p.user_id, u.username, u.webauthn_user_id, u.disabled_at is not null as disabled
    from passkeys p join users u on u.id = p.user_id
    where p.credential_id = ${credentialId}`
  if (!row) return null
  return {
    ...toRow(row),
    userId: Number(row.user_id),
    username: row.username,
    userHandle: row.webauthn_user_id,
    disabled: row.disabled,
  }
}

export async function recordUse(db: Db, id: string, { signCount, backedUp }: { signCount: number; backedUp: boolean }) {
  await db`
    update passkeys set sign_count = ${signCount}, backed_up = ${backedUp}, last_used_at = now() where id = ${id}`
}

export type ChallengeKind = 'register' | 'sign-in'

export const hashChallenge = (challenge: Uint8Array): Buffer => createHash('sha256').update(challenge).digest()

export async function makeChallenge(
  pool: Pool,
  { kind, userId, ip }: { kind: ChallengeKind; userId: number | null; ip: string | null },
): Promise<Buffer> {
  const challenge = randomBytes(32)
  await sweepChallenges(pool)
  await pool.begin(async (tx) => {
    if (kind === 'register') await tx`delete from passkey_challenges where user_id = ${userId} and kind = 'register'`
    await tx`
      insert into passkey_challenges (challenge_hash, kind, user_id, ip, expires_at)
      values (${hashChallenge(challenge)}, ${kind}, ${userId}, ${ip},
        now() + make_interval(secs => ${CHALLENGE_TTL_MS / 1000}))`
  })
  return challenge
}

export async function takeChallenge(
  db: Db,
  hash: Buffer,
  kind: ChallengeKind,
  userId: number | null,
): Promise<boolean> {
  const rows = await db`
    update passkey_challenges set used_at = now()
    where challenge_hash = ${hash} and kind = ${kind} and user_id is not distinct from ${userId}
      and used_at is null and expires_at > now()
    returning 1`
  return rows.length > 0
}

export async function signInChallengeTimes(db: Db, ip: string, since: Date): Promise<Date[]> {
  const rows = await db<{ created_at: Date }[]>`
    select created_at from passkey_challenges
    where kind = 'sign-in' and ip = ${ip}::inet and created_at > ${since}`
  return rows.map((r) => r.created_at)
}

export async function sweepChallenges(db: Db): Promise<void> {
  await db`delete from passkey_challenges where created_at < now() - interval '1 hour'`
}
