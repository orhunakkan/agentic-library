import { ADMIN_INTENTS, type AdminRole, type NewUser, type UserChange } from '../../shared/admin/users.ts'
import { isObject, isOneOf, only } from '../../shared/lib/json-shape.ts'
import { isValidUsername, normalizeUsername, ROLES } from '../users.ts'

const RAW_USERNAME_MAX = 64

const isRole = (value: unknown): value is AdminRole => isOneOf(value, ROLES)

const RESERVED_USERNAME = 'new'

export function parseNewUser(value: unknown): NewUser | null {
  if (!isObject(value) || !only(value, ['username', 'role'])) return null
  if (typeof value.username !== 'string' || value.username.length > RAW_USERNAME_MAX) return null
  const username = normalizeUsername(value.username)
  if (!isValidUsername(username) || username === RESERVED_USERNAME) return null
  if (value.role === undefined) return { username, role: 'member' }
  return isRole(value.role) ? { username, role: value.role } : null
}

export function parseUserChange(value: unknown): UserChange | null {
  if (!isObject(value) || !isOneOf(value.intent, ADMIN_INTENTS)) return null
  if (value.intent === 'role')
    return only(value, ['intent', 'role']) && isRole(value.role) ? { intent: 'role', role: value.role } : null
  return only(value, ['intent']) ? { intent: value.intent } : null
}
