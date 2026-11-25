import { isObject, only } from '../../shared/lib/json-shape.ts'
import { isUuid } from '../../shared/uuid.ts'
import { isWellFormedAccessToken } from '../security.ts'

const TOKEN_NAME_MAX = 60
const DEFAULT_TOKEN_NAME = 'Access token'
const MAX_TOKEN_DAYS = 30
const USERNAME_FIELD_MAX = 64
const PASSWORD_FIELD_MAX = 1024

export type Authorization = { kind: 'none' } | { kind: 'bearer'; token: string } | { kind: 'invalid'; bearer: boolean }

export function parseAuthorization(value: string | null): Authorization {
  if (value === null) return { kind: 'none' }
  const match = /^bearer ([^\s,]+)$/i.exec(value)
  if (match && isWellFormedAccessToken(match[1])) return { kind: 'bearer', token: match[1] }
  return { kind: 'invalid', bearer: /^bearer(\s|$)/i.test(value) }
}

export interface TokenCreateInput {
  username: string
  password: string
  name: string
  days: number
}

function tokenName(value: unknown): string | null {
  if (value === undefined) return DEFAULT_TOKEN_NAME
  if (typeof value !== 'string') return null
  const name = value.trim()
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are exactly what is refused here.
  if (!name || name.length > TOKEN_NAME_MAX || /[\u0000-\u001f\u007f-\u009f]/.test(name)) return null
  return name
}

function tokenDays(value: unknown): number | null {
  if (value === undefined) return MAX_TOKEN_DAYS
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_TOKEN_DAYS ? value : null
}

export function parseTokenCreate(value: unknown): TokenCreateInput | null {
  if (!isObject(value) || !only(value, ['username', 'password', 'name', 'expiresInDays'])) return null
  const { username, password } = value
  if (typeof username !== 'string' || username.length > USERNAME_FIELD_MAX) return null
  if (typeof password !== 'string' || password.length > PASSWORD_FIELD_MAX) return null
  const name = tokenName(value.name)
  const days = tokenDays(value.expiresInDays)
  if (name === null || days === null) return null
  return { username, password, name, days }
}

export function parseTokenRevoke(value: unknown): boolean {
  return isObject(value) && only(value, ['intent']) && value.intent === 'revoke'
}

export function isTokenId(value: string): boolean {
  return isUuid(value)
}
