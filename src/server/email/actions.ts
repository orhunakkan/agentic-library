import '@tanstack/react-start/server-only'
import { ipEventTimes, recordEvent } from '../audit.ts'
import { forbidden, loginHref, requestIp, seeOther, sessionForRequest } from '../auth.ts'
import { getConfig } from '../config.ts'
import { getDb, type Pool } from '../db.ts'
import { formField, readForm } from '../json-body.ts'
import { mailAvailable, sendMail } from '../mail/mail.ts'
import { addressChangedNotice, confirmMessage, passwordResetNotice, resetMessage } from '../mail/messages.ts'
import { hashPassword, passwordProblem } from '../passwords.ts'
import { EMAIL_VERIFY_LIMIT, overLimit, RESET_ACCOUNT_LIMIT, RESET_IP_LIMIT } from '../rate-limit.ts'
import { logError } from '../redact.ts'
import { hashToken, isSameOrigin, isWellFormedToken } from '../security.ts'
import type { SessionUser } from '../sessions.ts'
import { findUserById } from '../users.ts'
import { parseEmail, parseResetIdentifier, sameAddress } from './input.ts'
import {
  type AddressState,
  accountsForReset,
  addressState,
  cancelToken,
  confirmAddress,
  createToken,
  findLiveResetToken,
  findLiveToken,
  pendingAddress,
  type ResetCandidate,
  removeAddress,
  resetPassword,
  supersedeTokens,
} from './store.ts'

const section = (query = '') => seeOther(`/account${query ? `?${query}` : ''}#email`)

const confirmHref = (token: string) => `${getConfig().appOrigin}/confirm-email?token=${token}`

async function sendConfirmation(session: SessionUser, email: string, ip: string | null, resend: boolean) {
  const db = getDb()
  const issued = await createToken(db, {
    userId: session.userId,
    purpose: 'verify',
    email,
    limit: EMAIL_VERIFY_LIMIT,
  })
  if (issued === 'limit') return section('error=email-limit')
  const origin = getConfig().appOrigin
  const result = await sendMail(db, {
    to: email,
    ...confirmMessage({ email, link: confirmHref(issued.token), origin }),
  })
  if (result !== 'sent') {
    await cancelToken(db, issued.id)
    if (result === 'invalid') return section('error=email-invalid')
    if (result === 'busy') return section('error=email-busy')
    return section('error=email-failed')
  }
  await supersedeTokens(db, session.userId, 'verify', issued.id)
  await recordEvent(db, 'email.verification_sent', { userId: session.userId, ip, detail: { resend } })
  return section('status=email-sent')
}

export async function handleEmailForm(
  session: SessionUser,
  form: FormData,
  ip: string | null,
  checkPassword: (password: string) => Promise<boolean>,
): Promise<Response> {
  if (!mailAvailable()) return section()
  const db = getDb()
  switch (formField(form, 'intent')) {
    case 'email-add': {
      const email = parseEmail(formField(form, 'email'))
      if (!email) return section('error=email-invalid')
      if (!(await checkPassword(formField(form, 'current')))) return section('error=email-current')
      const user = await findUserById(db, session.userId)
      if (user?.email && sameAddress(user.email, email) && !user.emailBouncedAt) return section('error=email-same')
      return sendConfirmation(session, email, ip, false)
    }
    case 'email-resend': {
      const pending = await pendingAddress(db, session.userId)
      if (!pending || pending.bounced) return section()
      return sendConfirmation(session, pending.email, ip, true)
    }
    default: {
      const pendingOnly = formField(form, 'pending') === '1'
      if (await removeAddress(db, session.userId, { pendingOnly }))
        await recordEvent(db, 'email.removed', {
          userId: session.userId,
          ip,
          detail: pendingOnly ? { pending: true } : {},
        })
      return pendingOnly ? section() : section('status=email-removed')
    }
  }
}

export async function emailSection(userId: number): Promise<AddressState | null> {
  if (!mailAvailable()) return null
  return addressState(getDb(), userId)
}

export type ConfirmPage =
  | { state: 'off' | 'invalid' | 'signed-out' | 'other-account' | 'unavailable' }
  | { state: 'ready'; email: string }

export async function confirmPage(request: Request, token: string | undefined): Promise<ConfirmPage> {
  if (!mailAvailable()) return { state: 'off' }
  if (!isWellFormedToken(token)) return { state: 'invalid' }
  try {
    const live = await findLiveToken(getDb(), hashToken(token), 'verify')
    if (!live) return { state: 'invalid' }
    const session = await sessionForRequest(request)
    if (!session) return { state: 'signed-out' }
    if (session.userId !== live.userId) return { state: 'other-account' }
    return { state: 'ready', email: live.email }
  } catch (error) {
    logError('confirm page', error)
    return { state: 'unavailable' }
  }
}

export async function handleConfirmEmail(request: Request): Promise<Response> {
  if (!isSameOrigin(request.headers, getConfig().appOrigin)) return forbidden()
  const form = await readForm(request)
  const token = form ? formField(form, 'token') : ''
  if (!mailAvailable() || !isWellFormedToken(token)) return seeOther('/confirm-email')
  const page = `/confirm-email?token=${token}`
  const session = await sessionForRequest(request)
  if (!session) return seeOther(loginHref(page))
  const ip = requestIp(request)
  try {
    const db = getDb()
    const live = await findLiveToken(db, hashToken(token), 'verify')
    if (!live || live.userId !== session.userId) return seeOther(page)
    const confirmed = await confirmAddress(db, { tokenId: live.id, userId: session.userId, ip })
    if (confirmed === 'invalid') return seeOther(page)
    const { previous } = confirmed
    if (previous && !previous.bounced && !sameAddress(previous.email, confirmed.email))
      await sendMail(db, {
        to: previous.email,
        ...addressChangedNotice({
          username: session.username,
          newEmail: confirmed.email,
          at: new Date(),
          origin: getConfig().appOrigin,
        }),
      })
    return seeOther('/account?status=email-confirmed#email')
  } catch (error) {
    logError('confirm email', error)
    return seeOther('/account?error=unavailable')
  }
}

const resetHref = (token: string) => `${getConfig().appOrigin}/reset-password?token=${token}`

export type ResetOutcome = 'sent' | 'unknown' | 'disabled' | 'no-address' | 'bounced' | 'limited' | 'failed'

async function resetFor(db: Pool, account: ResetCandidate): Promise<ResetOutcome> {
  if (account.disabled) return 'disabled'
  if (!account.email) return 'no-address'
  if (account.bounced) return 'bounced'
  const issued = await createToken(db, {
    userId: account.id,
    purpose: 'reset',
    email: account.email,
    limit: RESET_ACCOUNT_LIMIT,
  })
  if (issued === 'limit') return 'limited'
  const result = await sendMail(db, {
    to: account.email,
    ...resetMessage({ username: account.username, link: resetHref(issued.token), origin: getConfig().appOrigin }),
  })
  if (result === 'sent') return 'sent'
  await cancelToken(db, issued.id)
  return result === 'skipped' ? 'bounced' : 'failed'
}

async function requestReset(input: string, ip: string | null): Promise<void> {
  const db = getDb()
  const identifier = parseResetIdentifier(input)
  const accounts = identifier ? await accountsForReset(db, identifier) : []
  const outcomes: ResetOutcome[] = []
  for (const account of accounts) outcomes.push(await resetFor(db, account))
  const outcome = outcomes.includes('sent') ? 'sent' : (outcomes[0] ?? 'unknown')
  await recordEvent(db, 'password.reset_requested', {
    userId: accounts.length === 1 ? (accounts[0] as ResetCandidate).id : null,
    ip,
    detail: { by: input.includes('@') ? 'email' : 'username', outcome, accounts: accounts.length },
  })
}

const inFlight = new Set<Promise<void>>()

export async function resetWorkSettled(): Promise<void> {
  await Promise.all([...inFlight])
}

export async function handleForgotPassword(request: Request): Promise<Response> {
  if (!isSameOrigin(request.headers, getConfig().appOrigin)) return forbidden()
  if (!mailAvailable()) return seeOther('/forgot-password')
  const form = await readForm(request)
  const input = form ? formField(form, 'identifier').trim() : ''
  if (!input || input.length > 254) return seeOther('/forgot-password?error=invalid')
  const ip = requestIp(request)
  try {
    if (ip) {
      const now = new Date()
      const since = new Date(now.getTime() - RESET_IP_LIMIT.windowMs)
      const times = await ipEventTimes(getDb(), ip, 'password.reset_requested', since)
      if (overLimit(times, RESET_IP_LIMIT, now)) return seeOther('/forgot-password?error=limited')
    }
  } catch (error) {
    logError('forgot password', error)
    return seeOther('/forgot-password?error=unavailable')
  }
  const work = requestReset(input, ip)
    .catch((error) => logError('forgot password', error))
    .finally(() => inFlight.delete(work))
  inFlight.add(work)
  return seeOther('/forgot-password?status=sent')
}

export type ResetPage = { state: 'off' | 'invalid' | 'unavailable' } | { state: 'ready'; username: string }

export async function resetPage(token: string | undefined): Promise<ResetPage> {
  if (!mailAvailable()) return { state: 'off' }
  if (!isWellFormedToken(token)) return { state: 'invalid' }
  try {
    const live = await findLiveResetToken(getDb(), hashToken(token))
    return live ? { state: 'ready', username: live.username } : { state: 'invalid' }
  } catch (error) {
    logError('reset page', error)
    return { state: 'unavailable' }
  }
}

export async function handleResetPassword(request: Request): Promise<Response> {
  if (!isSameOrigin(request.headers, getConfig().appOrigin)) return forbidden()
  const form = await readForm(request)
  const token = form ? formField(form, 'token') : ''
  if (!form || !mailAvailable() || !isWellFormedToken(token)) return seeOther('/reset-password')
  const page = `/reset-password?token=${token}`
  const password = formField(form, 'password')
  try {
    const db = getDb()
    const live = await findLiveResetToken(db, hashToken(token))
    if (!live) return seeOther(page)
    if (password !== formField(form, 'confirm')) return seeOther(`${page}&error=mismatch`)
    const problem = passwordProblem(password, live.username)
    if (problem) return seeOther(`${page}&error=policy&reason=${problem}`)
    const done = await resetPassword(db, {
      tokenId: live.id,
      userId: live.userId,
      passwordHash: await hashPassword(password),
      ip: requestIp(request),
    })
    if (done === 'invalid') return seeOther(page)
    await sendMail(db, {
      to: done.email,
      ...passwordResetNotice({ username: done.username, at: new Date(), origin: getConfig().appOrigin }),
    })
    return seeOther('/login?status=password-reset')
  } catch (error) {
    logError('reset password', error)
    return seeOther(`${page}&error=unavailable`)
  }
}
