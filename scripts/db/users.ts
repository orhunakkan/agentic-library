import { parseArgs } from 'node:util'
import { type AccessEnded, endedDetail, endUserAccess } from '../../src/server/access-tokens/store.ts'
import { deleteAccount, setRole } from '../../src/server/admin/store.ts'
import { recordEvent } from '../../src/server/audit.ts'
import { closeDb, getDb } from '../../src/server/db.ts'
import { clearFailures } from '../../src/server/login-attempts.ts'
import { removePasskeysForReset } from '../../src/server/passkeys/store.ts'
import { generatePassword, hashPassword } from '../../src/server/passwords.ts'
import { grantPro, planSourceFor, revokePro } from '../../src/server/plans/plan.ts'
import {
  createUser,
  findUserByUsername,
  isValidUsername,
  listUsers,
  normalizeUsername,
  ROLES,
  setDisabled,
  setPasswordHash,
} from '../../src/server/users.ts'
import { isOneOf } from '../../src/shared/lib/json-shape.ts'
import { planLabel } from '../../src/shared/plans/copy.ts'

const USAGE = `usage: node scripts/db/users.ts <command>
  create <username> --role admin|member   create an account and print its generated password once
  set-password <username>                 print a new generated password, end the user's sessions and access
                                          tokens and remove their passkeys
  disable <username> | enable <username>  disabling also ends the user's sessions and access tokens
  unlock <username>                       clear the sign-in lock after failed attempts
  revoke-sessions <username>              end every session and access token of the user
  set-role <username> admin|member        change the role; refused for the only enabled admin
  grant-pro <username> | revoke-pro <username>
                                          give a member Pro, or take it back; refused for an admin, who is always Pro
  delete <username> [--skip-billing]      delete the account and everything in it; refused for the only enabled admin.
                                          A Pro subscription is cancelled at Paddle first; --skip-billing leaves it
                                          to be cancelled in Paddle's dashboard, for when Paddle can't be reached
  list                                    every account with its role, plan, sessions, whether a key is saved and its
                                          email status`

class UsageError extends Error {}

const detail = { via: 'users script', osUser: process.env.USER ?? process.env.USERNAME ?? null }

const endedText = ({ sessionsEnded, tokensEnded }: AccessEnded) =>
  `${sessionsEnded} session(s)${tokensEnded > 0 ? ` and ${tokensEnded} access token(s)` : ''} ended`

async function existing(username: string | undefined) {
  if (!username) throw new UsageError('missing <username>')
  const user = await findUserByUsername(getDb(), username)
  if (!user) throw new Error(`no user named "${normalizeUsername(username)}"`)
  return user
}

async function run(argv: string[]): Promise<void> {
  const { positionals, values } = parseArgs({
    args: argv,
    options: { role: { type: 'string' }, 'skip-billing': { type: 'boolean' } },
    allowPositionals: true,
  })
  const [command, name] = positionals
  const db = getDb()
  switch (command) {
    case 'create': {
      if (!name) throw new UsageError('missing <username>')
      const username = normalizeUsername(name)
      if (!isValidUsername(username))
        throw new Error('usernames are 3–32 characters: a-z, 0-9, _ and -, starting with a letter or digit')
      const role = values.role
      if (!isOneOf(role, ROLES)) throw new UsageError('--role must be admin or member')
      const password = generatePassword()
      const user = await createUser(db, username, await hashPassword(password), role)
      await recordEvent(db, 'user.created', { userId: user.id, detail: { ...detail, role } })
      console.log(`created ${user.username} (${user.role})\npassword: ${password}\nIt is shown only this once.`)
      return
    }
    case 'set-password': {
      const user = await existing(name)
      const password = generatePassword()
      const passwordHash = await hashPassword(password)
      const passkeys = await db.begin(async (tx) => {
        await setPasswordHash(tx, user.id, passwordHash)
        return removePasskeysForReset(tx, user.id, { detail })
      })
      const ended = await endUserAccess(db, user.id, { via: 'script' })
      await recordEvent(db, 'password.changed', { userId: user.id, detail: { ...detail, ...endedDetail(ended) } })
      console.log(
        `new password for ${user.username}: ${password}\nIt is shown only this once. ${endedText(ended)}, ` +
          `${passkeys} passkey(s) removed.`,
      )
      return
    }
    case 'disable':
    case 'enable': {
      const user = await existing(name)
      const disabled = command === 'disable'
      await setDisabled(db, user.id, disabled)
      const ended = disabled
        ? await endUserAccess(db, user.id, { via: 'script' })
        : { sessionsEnded: 0, tokensEnded: 0 }
      await recordEvent(db, disabled ? 'user.disabled' : 'user.enabled', {
        userId: user.id,
        detail: { ...detail, ...endedDetail(ended) },
      })
      console.log(`${user.username} ${disabled ? `disabled; ${endedText(ended)}` : 'enabled'}`)
      return
    }
    case 'unlock': {
      const user = await existing(name)
      const cleared = await clearFailures(db, user.username)
      await recordEvent(db, 'user.unlocked', { userId: user.id, detail: { ...detail, failuresCleared: cleared } })
      console.log(`${user.username} unlocked (${cleared} failed attempt(s) cleared)`)
      return
    }
    case 'revoke-sessions': {
      const user = await existing(name)
      const ended = await endUserAccess(db, user.id, { via: 'script' })
      await recordEvent(db, 'sessions.revoked', { userId: user.id, detail: { ...detail, ...endedDetail(ended) } })
      console.log(`${endedText(ended)} for ${user.username}`)
      return
    }
    case 'set-role': {
      const user = await existing(name)
      const role = positionals[2]
      if (!isOneOf(role, ROLES)) throw new UsageError('the role must be admin or member')
      const result = await setRole(db, user.id, role)
      if (result === 'missing') throw new Error(`no user named "${user.username}"`)
      if (result === 'last_admin') throw new Error(`${user.username} is the only enabled admin`)
      const described = role === 'admin' ? 'an admin' : 'a member'
      if (result.from === result.to) {
        console.log(`${user.username} is already ${described}`)
        return
      }
      await recordEvent(db, 'user.role_changed', { userId: user.id, detail: { ...detail, ...result } })
      console.log(`${user.username} is now ${described}`)
      return
    }
    case 'grant-pro':
    case 'revoke-pro': {
      const user = await existing(name)
      const give = command === 'grant-pro'
      const result = await (give ? grantPro : revokePro)(db, user.id, {
        by: null,
        via: 'users script',
        ...(detail.osUser ? { osUser: detail.osUser } : {}),
      })
      if (result === 'not_found') throw new Error(`no user named "${user.username}"`)
      if (result === 'admin') throw new Error(`${user.username} is an admin, and admins are always on Pro`)
      const now = give ? 'on Pro' : 'on Free'
      console.log(result.changed ? `${user.username} is ${now} now` : `${user.username} is already ${now}`)
      return
    }
    case 'delete': {
      const user = await existing(name)
      const skipBilling = values['skip-billing'] === true
      const result = await deleteAccount(
        db,
        user.id,
        { detail: { ...detail, ...(skipBilling ? { skipBilling } : {}) } },
        { skipBilling },
      )
      if (result === 'missing') throw new Error(`no user named "${user.username}"`)
      if (result === 'last_admin') throw new Error(`${user.username} is the only enabled admin`)
      if (result === 'billing_failed')
        throw new Error(
          `Paddle couldn't cancel ${user.username}'s subscription, so nothing was deleted. Try again, or cancel it in Paddle's dashboard and rerun with --skip-billing`,
        )
      console.log(`${user.username} deleted, with everything in the account`)
      return
    }
    case 'list': {
      const users = await listUsers(db)
      const date = (d: Date | null) => (d ? d.toISOString().slice(0, 16).replace('T', ' ') : '-')
      console.table(
        users.map((u) => ({
          username: u.username,
          role: u.role,
          plan: planLabel(planSourceFor(u.role, u.proGiven, u.paid !== null), u.paid),
          created: date(u.createdAt),
          disabled: date(u.disabledAt),
          sessions: u.activeSessions,
          'api key': u.hasApiKey ? 'yes' : 'no',
          email: u.email,
        })),
      )
      return
    }
    default:
      throw new UsageError(command ? `unknown command "${command}"` : 'missing <command>')
  }
}

try {
  await run(process.argv.slice(2))
} catch (error) {
  console.error(`users: ${(error as Error).message}`)
  if (error instanceof UsageError) console.error(USAGE)
  process.exitCode = 1
} finally {
  await closeDb()
}
