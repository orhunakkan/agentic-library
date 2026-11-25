import type { PaidLabel } from '../plans/copy.ts'
import type { Plan, PlanSource } from '../plans/plans.ts'

export type AdminRole = 'admin' | 'member'

export type EmailStatus = 'confirmed' | 'bounced' | 'none'

export function emailStatus(hasEmail: boolean, bounced: boolean): EmailStatus {
  if (!hasEmail) return 'none'
  return bounced ? 'bounced' : 'confirmed'
}

export interface AdminUserView {
  username: string
  role: AdminRole
  status: 'active' | 'disabled' | 'locked'
  lockedUntil: string | null
  createdAt: string
  lastActiveAt: string | null
  sessions: number
  hasKey: boolean
  email: EmailStatus
  plan: Plan
  planSource: PlanSource
  paid: PaidLabel | null
  you: boolean
}

export const ADMIN_PROBLEMS = [
  'taken',
  'invalid',
  'last_admin',
  'self',
  'not_found',
  'signed_out',
  'failed',
  'quota',
  'closed',
  'admin',
  'billing',
] as const
export type AdminProblem = (typeof ADMIN_PROBLEMS)[number]

export const ADMIN_INTENTS = [
  'reset-password',
  'disable',
  'enable',
  'unlock',
  'sign-out',
  'role',
  'grant-pro',
  'revoke-pro',
  'delete',
] as const
export type AdminIntent = (typeof ADMIN_INTENTS)[number]

export type UserChange = { intent: Exclude<AdminIntent, 'role'> } | { intent: 'role'; role: AdminRole }

export interface NewUser {
  username: string
  role: AdminRole
}

export type RowAction =
  | 'reset-password'
  | 'make-admin'
  | 'make-member'
  | 'give-pro'
  | 'take-pro'
  | 'unlock'
  | 'sign-out'
  | 'disable'
  | 'enable'
  | 'delete'

export function rowActions(view: AdminUserView): RowAction[] {
  if (view.you) return []
  const actions: RowAction[] = ['reset-password', view.role === 'admin' ? 'make-member' : 'make-admin']
  if (view.role === 'member') actions.push(view.planSource === 'given' ? 'take-pro' : 'give-pro')
  if (view.lockedUntil !== null) actions.push('unlock')
  if (view.sessions > 0) actions.push('sign-out')
  actions.push(view.status === 'disabled' ? 'enable' : 'disable', 'delete')
  return actions
}

export function sortUsers(users: readonly AdminUserView[]): AdminUserView[] {
  return [...users].sort((a, b) => (a.username < b.username ? -1 : a.username > b.username ? 1 : 0))
}

export interface InviteView {
  id: string
  note: string | null
  by: string | null
  createdAt: string
  expiresAt: string
}

export interface MadeInvite {
  invite: InviteView
  link: string
}
