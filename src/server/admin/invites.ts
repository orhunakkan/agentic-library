import '@tanstack/react-start/server-only'
import { INVITE_MAX } from '~/shared/signup/signup'
import { isUuid } from '../../shared/uuid.ts'
import { recordEvent } from '../audit.ts'
import { noStoreJson, requestIp } from '../auth.ts'
import { getConfig } from '../config.ts'
import { getDb } from '../db.ts'
import { signupHref } from '../signup/actions.ts'
import { parseInviteChange, parseNewInvite } from '../signup/input.ts'
import { createInvite, pendingInvites, revokeInvite } from '../signup/store.ts'
import { toInviteView } from '../signup/view.ts'
import { adminOnly, admins, fail } from './caller.ts'

export const handleNewInvite = (request: Request) =>
  admins.post(
    request,
    { log: 'users page invite', before: adminOnly, parse: parseNewInvite },
    async ({ session, db, input }) => {
      if (getConfig().signup === 'off') return fail(409, 'closed')
      const made = await createInvite(db, { by: session.userId, note: input.note })
      if (made === 'quota') return fail(409, 'quota', { max: INVITE_MAX })
      await recordEvent(db, 'invite.created', {
        userId: session.userId,
        ip: requestIp(request),
        detail: { invite: made.row.id, by: session.userId, note: input.note !== null },
      })
      return noStoreJson(200, { invite: toInviteView(made.row), link: signupHref(made.token) })
    },
  )

export const handleInviteChange = (request: Request, id: string) =>
  admins.post(
    request,
    {
      log: 'users page revoke invite',
      before: (gate) => adminOnly(gate) ?? (isUuid(id) ? undefined : fail(404, 'not_found')),
      parse: (value) => parseInviteChange(value) || null,
    },
    async ({ session, db }) => {
      if ((await revokeInvite(db, id)) === 'missing') return fail(404, 'not_found')
      await recordEvent(db, 'invite.revoked', {
        userId: session.userId,
        ip: requestIp(request),
        detail: { invite: id, by: session.userId },
      })
      return noStoreJson(200, { revoked: id })
    },
  )

export async function invitesForAdmin() {
  if (getConfig().signup === 'off') return []
  return (await pendingInvites(getDb())).map(toInviteView)
}
