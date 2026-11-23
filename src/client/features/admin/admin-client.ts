import { type ChangeResult, post } from '~/client/features/highlights/highlights-client'
import {
  ADMIN_PROBLEMS,
  type AdminProblem,
  type AdminRole,
  type AdminUserView,
  type InviteView,
  type MadeInvite,
  type RowAction,
  type UserChange,
} from '~/shared/admin/users'
import { INVITE_MAX } from '~/shared/signup/signup'

export type AdminResult<T> = ChangeResult<T, AdminProblem>

export interface ChangedUser {
  user: AdminUserView
  password: string | null
}

async function readAdminAnswer<T>(
  response: Response,
  pick: (body: Record<string, unknown>) => T | undefined,
): Promise<AdminResult<T>> {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (response.ok) {
    const value = pick(body)
    return value === undefined ? { ok: false, problem: 'failed' } : { ok: true, value }
  }
  const code = ADMIN_PROBLEMS.find((p) => p === body.error)
  return { ok: false, problem: code ?? 'failed' }
}

async function send<T>(
  path: string,
  body: unknown,
  pick: (body: Record<string, unknown>) => T | undefined,
): Promise<AdminResult<T>> {
  let response: Response
  try {
    response = await post(path, body)
  } catch {
    return { ok: false, problem: 'failed' }
  }
  return readAdminAnswer(response, pick)
}

const changedOf = (body: Record<string, unknown>): ChangedUser | undefined =>
  body.user && typeof body.user === 'object'
    ? { user: body.user as AdminUserView, password: typeof body.password === 'string' ? body.password : null }
    : undefined

const userPath = (username: string) => `/account/users/${encodeURIComponent(username)}`

export function addUser(username: string, role: AdminRole): Promise<AdminResult<ChangedUser>> {
  return send('/account/users/new', { username, role }, changedOf)
}

export function changeUser(username: string, change: UserChange): Promise<AdminResult<ChangedUser>> {
  return send(userPath(username), change, changedOf)
}

export function deleteUser(username: string): Promise<AdminResult<string>> {
  return send(userPath(username), { intent: 'delete' }, (b) => (typeof b.deleted === 'string' ? b.deleted : undefined))
}

const inviteOf = (value: unknown): InviteView | undefined =>
  value && typeof value === 'object' && typeof (value as InviteView).id === 'string' ? (value as InviteView) : undefined

export function createInvite(note: string): Promise<AdminResult<MadeInvite>> {
  const trimmed = note.trim()
  return send('/account/users/invites/new', trimmed ? { note: trimmed } : {}, (b) => {
    const invite = inviteOf(b.invite)
    return invite && typeof b.link === 'string' ? { invite, link: b.link } : undefined
  })
}

export function revokeInvite(id: string): Promise<AdminResult<string>> {
  return send(`/account/users/invites/${encodeURIComponent(id)}`, { intent: 'revoke' }, (b) =>
    typeof b.revoked === 'string' ? b.revoked : undefined,
  )
}

export function problemText(problem: AdminProblem, on: 'add' | 'change'): string {
  switch (problem) {
    case 'taken':
      return 'That username is taken.'
    case 'invalid':
      return on === 'add'
        ? 'Usernames are 3–32 characters: a–z, 0–9, _ and -, starting with a letter or digit.'
        : 'That request wasn’t understood. Reload and try again.'
    case 'last_admin':
      return 'Folio needs at least one admin. Make someone else an admin first.'
    case 'self':
      return 'Change your own account on the Account page.'
    case 'not_found':
      return 'That user no longer exists. Reload the page.'
    case 'signed_out':
      return 'Your session has ended. Sign in again.'
    case 'failed':
      return 'Something went wrong. Try again in a few minutes.'
    case 'quota':
      return `There are already ${INVITE_MAX} open invites. Revoke one first.`
    case 'closed':
      return 'Sign-up is turned off on this server, so invites can’t be made.'
    case 'admin':
      return 'Admins are always on Pro.'
    case 'billing':
      return 'Couldn’t cancel their Pro subscription, so the account wasn’t deleted. Try again, or cancel it in Paddle first.'
  }
}

export const ACTION_LABELS: Record<RowAction, string> = {
  'reset-password': 'Reset password',
  'make-admin': 'Make admin',
  'make-member': 'Make member',
  'give-pro': 'Give Pro…',
  'take-pro': 'Take back Pro…',
  unlock: 'Unlock',
  'sign-out': 'Sign out everywhere',
  disable: 'Disable',
  enable: 'Enable',
  delete: 'Delete…',
}

export function changeFor(action: Exclude<RowAction, 'delete'>): UserChange {
  switch (action) {
    case 'make-admin':
      return { intent: 'role', role: 'admin' }
    case 'make-member':
      return { intent: 'role', role: 'member' }
    case 'give-pro':
      return { intent: 'grant-pro' }
    case 'take-pro':
      return { intent: 'revoke-pro' }
    default:
      return { intent: action }
  }
}

export function doneText(action: RowAction | 'add', username: string): string {
  switch (action) {
    case 'add':
      return `${username} was added.`
    case 'reset-password':
      return `${username}’s password was reset.`
    case 'make-admin':
      return `${username} is now an admin.`
    case 'make-member':
      return `${username} is now a member.`
    case 'give-pro':
      return `${username} is on Pro now.`
    case 'take-pro':
      return `${username} is on Free now.`
    case 'unlock':
      return `${username} was unlocked.`
    case 'sign-out':
      return `${username} was signed out everywhere.`
    case 'disable':
      return `${username} was disabled.`
    case 'enable':
      return `${username} was enabled.`
    case 'delete':
      return `${username} was deleted.`
  }
}
