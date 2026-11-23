import '@tanstack/react-start/server-only'
import { type AddPasskeyError, MAX_PASSKEYS, NAME_MAX } from '../../shared/passkeys/passkeys.ts'
import { recordEvent } from '../audit.ts'
import { noStoreJson, requestIp } from '../auth.ts'
import { getConfig } from '../config.ts'
import { checkCurrentPassword } from '../current-password.ts'
import { getDb } from '../db.ts'
import { describeDevice } from '../device.ts'
import { mailAvailable, sendMail } from '../mail/mail.ts'
import { passkeyAddedNotice } from '../mail/messages.ts'
import { logError } from '../redact.ts'
import type { SessionUser } from '../sessions.ts'
import { signedInEndpoints } from '../signed-in.ts'
import { findUserById } from '../users.ts'
import { registrationOptions, verifyRegistration } from './ceremony.ts'
import { challengeOf, parseAddOptions, parseNewPasskey } from './input.ts'
import { rpFor } from './relying-party.ts'
import {
  addPasskey,
  countPasskeys,
  hashChallenge,
  listPasskeys,
  makeChallenge,
  takeChallenge,
  userHandle,
} from './store.ts'
import { toPasskeyView } from './view.ts'

const OPTIONS_BODY_BYTES = 1024
const NEW_BODY_BYTES = 16 * 1024

const passkeys = signedInEndpoints<AddPasskeyError>({
  maxBytes: OPTIONS_BODY_BYTES,
  codes: { signedOut: 'signed_out', invalid: 'invalid', failed: 'failed' },
})
const { fail } = passkeys

const quota = () => fail(409, 'quota', { max: MAX_PASSKEYS })

export function passkeyName(userAgent: string | null): string {
  const device = describeDevice(userAgent)
  return (device === 'Unknown device' ? 'Passkey' : device).slice(0, NAME_MAX)
}

export const handleAddOptions = (request: Request) =>
  passkeys.post(request, { log: 'passkey options', parse: parseAddOptions }, async ({ session, db, input }) => {
    if (!(await checkCurrentPassword(db, session, input.password, requestIp(request), 'passkey')))
      return fail(400, 'password')
    if ((await countPasskeys(db, session.userId)) >= MAX_PASSKEYS) return quota()
    const handle = await userHandle(db, session.userId)
    const exclude = (await listPasskeys(db, session.userId)).map((p) => ({
      id: p.credentialId.toString('base64url'),
      transports: p.transports,
    }))
    const challenge = await makeChallenge(db, { kind: 'register', userId: session.userId, ip: requestIp(request) })
    const options = await registrationOptions({
      rp: rpFor(getConfig().appOrigin),
      userHandle: handle,
      username: session.username,
      challenge,
      exclude,
    })
    return noStoreJson(200, { options })
  })

const mailWork = new Set<Promise<void>>()

export async function passkeyMailSettled(): Promise<void> {
  await Promise.all([...mailWork])
}

function mailAboutPasskey(session: SessionUser, name: string, at: Date): void {
  if (!mailAvailable()) return
  const work = (async () => {
    const db = getDb()
    const user = await findUserById(db, session.userId)
    if (!user?.email || user.emailBouncedAt) return
    await sendMail(db, {
      to: user.email,
      ...passkeyAddedNotice({ username: session.username, name, at, origin: getConfig().appOrigin }),
    })
  })()
    .catch((error) => logError('passkey mail', error))
    .finally(() => mailWork.delete(work))
  mailWork.add(work)
}

export const handleNewPasskey = (request: Request) =>
  passkeys.post(
    request,
    { log: 'passkey new', body: { json: NEW_BODY_BYTES }, parse: parseNewPasskey },
    async ({ session, db, input }) => {
      const ip = requestIp(request)
      const challenge = challengeOf(input.credential)
      if (!challenge || !(await takeChallenge(db, hashChallenge(challenge), 'register', session.userId)))
        return fail(400, 'expired')
      const verified = await verifyRegistration({
        rp: rpFor(getConfig().appOrigin),
        credential: input.credential,
        challenge: challenge.toString('base64url'),
      })
      if (!verified.ok) {
        await recordEvent(db, 'passkey.refused', { userId: session.userId, ip, detail: { reason: verified.reason } })
        return fail(400, 'refused')
      }
      const name = passkeyName(request.headers.get('user-agent'))
      const added = await addPasskey(db, session.userId, { ...verified, name })
      if (added === 'quota') return quota()
      if (added === 'taken') return fail(409, 'taken')
      await recordEvent(db, 'passkey.added', {
        userId: session.userId,
        ip,
        detail: { passkey: added.id, backedUp: added.backedUp },
      })
      mailAboutPasskey(session, name, added.createdAt)
      return noStoreJson(200, { passkey: toPasskeyView(added) })
    },
  )
