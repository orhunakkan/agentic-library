import '@tanstack/react-start/server-only'
import type { AdminUserView, UserChange } from '~/shared/admin/users'
import { endedDetail, endUserAccess } from '../access-tokens/store.ts'
import { recordEvent } from '../audit.ts'
import { noStoreJson, requestIp } from '../auth.ts'
import { getDb } from '../db.ts'
import { clearFailures } from '../login-attempts.ts'
import { removePasskeysForReset } from '../passkeys/store.ts'
import { generatePassword, hashPassword } from '../passwords.ts'
import type { SessionUser } from '../sessions.ts'
import { findUserByUsername, isValidUsername, setPasswordHash, type User } from '../users.ts'
import { adminOnly, admins, fail } from './caller.ts'
import { parseNewUser, parseUserChange } from './input.ts'
import { addUser, deleteAccount, listForAdmin, setDisabledGuarded, setRole } from './store.ts'
import { toAdminUserView, toAdminUserViews } from './view.ts'

async function rowOf(admin: SessionUser, username: string, extra: { password?: string } = {}): Promise<Response> {
  const [row] = await listForAdmin(getDb(), admin.userId, username)
  return row ? noStoreJson(200, { user: toAdminUserView(row), ...extra }) : fail(404, 'not_found')
}

export async function usersForAdmin(session: SessionUser): Promise<AdminUserView[] | null> {
  if (session.role !== 'admin') return null
  return toAdminUserViews(await listForAdmin(getDb(), session.userId))
}

export const handleNewUser = (request: Request) =>
  admins.post(
    request,
    { log: 'users page add', before: adminOnly, parse: parseNewUser },
    async ({ session, db, input }) => {
      const password = generatePassword()
      const user = await addUser(db, input.username, await hashPassword(password), input.role)
      if (user === 'taken') return fail(409, 'taken')
      await recordEvent(db, 'user.created', {
        userId: user.id,
        ip: requestIp(request),
        detail: { via: 'users page', by: session.userId, role: user.role },
      })
      return await rowOf(session, user.username, { password })
    },
  )

export const handleUserChange = (request: Request, username: string) =>
  admins.post(
    request,
    {
      log: 'users page change',
      before: (gate) => adminOnly(gate) ?? (isValidUsername(username) ? undefined : fail(404, 'not_found')),
      parse: parseUserChange,
    },
    async ({ session, db, input: change }) => {
      const target = await findUserByUsername(db, username)
      if (!target) return fail(404, 'not_found')
      if (target.id === session.userId) return fail(409, 'self')
      return await apply(request, session, target, change)
    },
  )

async function apply(request: Request, admin: SessionUser, target: User, change: UserChange): Promise<Response> {
  const db = getDb()
  const ip = requestIp(request)
  const by = { via: 'users page', by: admin.userId }
  const audit = (event: Parameters<typeof recordEvent>[1], detail: object) =>
    recordEvent(db, event, { userId: target.id, ip, detail: { ...by, ...detail } })

  switch (change.intent) {
    case 'reset-password': {
      const password = generatePassword()
      const passwordHash = await hashPassword(password)
      await db.begin(async (tx) => {
        await setPasswordHash(tx, target.id, passwordHash)
        await removePasskeysForReset(tx, target.id, { ip, detail: by })
      })
      const ended = await endUserAccess(db, target.id, { via: 'admin', ip })
      const failuresCleared = await clearFailures(db, target.username)
      await audit('password.changed', { ...endedDetail(ended), failuresCleared })
      return rowOf(admin, target.username, { password })
    }
    case 'disable':
    case 'enable': {
      const disabled = change.intent === 'disable'
      const result = await setDisabledGuarded(db, target.id, disabled, { via: 'admin', ip })
      if (result === 'missing') return fail(404, 'not_found')
      if (result === 'last_admin') return fail(409, 'last_admin')
      await audit(disabled ? 'user.disabled' : 'user.enabled', result)
      return rowOf(admin, target.username)
    }
    case 'unlock': {
      const failuresCleared = await clearFailures(db, target.username)
      await audit('user.unlocked', { failuresCleared })
      return rowOf(admin, target.username)
    }
    case 'sign-out': {
      await audit('sessions.revoked', endedDetail(await endUserAccess(db, target.id, { via: 'admin', ip })))
      return rowOf(admin, target.username)
    }
    case 'role': {
      const result = await setRole(db, target.id, change.role)
      if (result === 'missing') return fail(404, 'not_found')
      if (result === 'last_admin') return fail(409, 'last_admin')
      if (result.from !== result.to) await audit('user.role_changed', { from: result.from, to: result.to })
      return rowOf(admin, target.username)
    }
    case 'delete': {
      const result = await deleteAccount(db, target.id, { ip, detail: by })
      if (result === 'missing') return fail(404, 'not_found')
      if (result === 'last_admin') return fail(409, 'last_admin')
      return noStoreJson(200, { deleted: target.username })
    }
  }
}
