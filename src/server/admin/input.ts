import type { AdminRole, NewUser, UserChange } from '../../shared/admin/users.ts'
import { isObject, only } from '../../shared/lib/json-shape.ts'
import { isValidUsername, normalizeUsername, ROLES } from '../users.ts'

const RAW_USERNAME_MAX = 64

const isRole = (value: unknown): value is AdminRole => ROLES.includes(value as AdminRole)

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
  if (!isObject(value)) return null
  if (value.intent === 'role')
    return only(value, ['intent', 'role']) && isRole(value.role) ? { intent: 'role', role: value.role } : null
  if (!only(value, ['intent'])) return null
  switch (value.intent) {
    case 'reset-password':
    case 'disable':
    case 'enable':
    case 'unlock':
    case 'sign-out':
    case 'grant-pro':
    case 'revoke-pro':
    case 'delete':
      return { intent: value.intent }
    default:
      return null
  }
}
