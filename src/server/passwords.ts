import { argon2, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

export interface Argon2Params {
  memory: number
  passes: number
  parallelism: number
}

export const PARAMS: Argon2Params = { memory: 65536, passes: 3, parallelism: 1 }
const SALT_BYTES = 16
const HASH_BYTES = 32

export const PASSWORD_MIN = 15
export const PASSWORD_MAX = 256

export type PasswordProblem = 'short' | 'long' | 'username'

export function passwordProblem(password: string, username: string): PasswordProblem | null {
  const normalized = password.normalize('NFC')
  const length = [...normalized].length
  if (length < PASSWORD_MIN) return 'short'
  if (length > PASSWORD_MAX) return 'long'
  if (normalized.toLowerCase() === username.toLowerCase()) return 'username'
  return null
}

function derive(password: string, salt: Buffer, params: Argon2Params): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    argon2(
      'argon2id',
      {
        message: password.normalize('NFC'),
        nonce: salt,
        memory: params.memory,
        passes: params.passes,
        parallelism: params.parallelism,
        tagLength: HASH_BYTES,
      },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  )
}

const b64 = (bytes: Buffer) => bytes.toString('base64').replace(/=+$/, '')

export async function hashPassword(password: string, params: Argon2Params = PARAMS): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const hash = await derive(password, salt, params)
  return `$argon2id$v=19$m=${params.memory},t=${params.passes},p=${params.parallelism}$${b64(salt)}$${b64(hash)}`
}

interface Parsed {
  params: Argon2Params
  salt: Buffer
  hash: Buffer
}

function parseHash(encoded: string): Parsed | null {
  const match = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(encoded)
  if (!match) return null
  return {
    params: { memory: Number(match[1]), passes: Number(match[2]), parallelism: Number(match[3]) },
    salt: Buffer.from(match[4] ?? '', 'base64'),
    hash: Buffer.from(match[5] ?? '', 'base64'),
  }
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parsed = parseHash(encoded)
  if (!parsed) return false
  const candidate = await derive(password, parsed.salt, parsed.params)
  return candidate.length === parsed.hash.length && timingSafeEqual(candidate, parsed.hash)
}

export function needsRehash(encoded: string, params: Argon2Params = PARAMS): boolean {
  const parsed = parseHash(encoded)
  if (!parsed) return true
  return (
    parsed.params.memory < params.memory ||
    parsed.params.passes < params.passes ||
    parsed.params.parallelism !== params.parallelism ||
    parsed.hash.length < HASH_BYTES
  )
}

let dummy: Promise<string> | undefined

export function dummyHash(): Promise<string> {
  dummy ??= hashPassword(randomBytes(18).toString('base64'))
  return dummy
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'

export function generatePassword(length = 24): string {
  let out = ''
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)]
  return out
}
