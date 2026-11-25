import '@tanstack/react-start/server-only'
import type { SignupMode } from '../../shared/signup/signup.ts'
import { startSession } from '../account-actions.ts'
import { ipEventTimes, recordEvent } from '../audit.ts'
import { forbidden, requestIp, seeOther, sessionForRequest } from '../auth.ts'
import { getConfig } from '../config.ts'
import { getDb, isDatabaseConfigured, type Pool } from '../db.ts'
import { readForm } from '../json-body.ts'
import { sendMail } from '../mail/mail.ts'
import { signupMessage } from '../mail/messages.ts'
import { hashPassword, passwordProblem } from '../passwords.ts'
import { overLimit, SIGNUP_DAILY_LIMIT, SIGNUP_IP_LIMIT } from '../rate-limit.ts'
import { logError } from '../redact.ts'
import { hashToken, isSameOrigin, isWellFormedToken } from '../security.ts'
import { parseSignupFinish, parseSignupRequest, usernameProblem } from './input.ts'
import {
  accountsWithAddress,
  cancelSignupToken,
  countRefusal,
  createAccountFromToken,
  createSignupToken,
  dailySignupCount,
  findLiveSignupToken,
  isSignupBounced,
  type SignupKind,
} from './store.ts'

export const signupHref = (token: string) => `${getConfig().appOrigin}/signup?token=${token}`

const kindAllowed = (kind: SignupKind) => {
  const mode = getConfig().signup
  return kind === 'invite' ? mode !== 'off' : mode === 'open'
}

export type SignupOutcome = 'sent' | 'existing' | 'bounced' | 'address-limited' | 'busy' | 'failed' | 'honeypot'

async function mailLink(db: Pool, email: string): Promise<{ outcome: SignupOutcome; existing: number }> {
  if (await isSignupBounced(db, email)) return { outcome: 'bounced', existing: 0 }
  const issued = await createSignupToken(db, { email })
  if (issued === 'address') return { outcome: 'address-limited', existing: 0 }
  if (issued === 'busy') return { outcome: 'busy', existing: 0 }
  const accounts = await accountsWithAddress(db, email)
  const existing = accounts.length
  const origin = getConfig().appOrigin
  const result = await sendMail(db, {
    to: email,
    ...signupMessage({ link: signupHref(issued.token), origin, existing: accounts }),
  })
  if (result === 'sent') return { outcome: existing > 0 ? 'existing' : 'sent', existing }
  await cancelSignupToken(db, issued.id)
  return { outcome: result === 'skipped' ? 'bounced' : 'failed', existing }
}

async function requestLink(email: string, ip: string | null): Promise<void> {
  const db = getDb()
  const detail = await mailLink(db, email)
  await recordEvent(db, 'signup.requested', { ip, detail })
}

const inFlight = new Set<Promise<void>>()

export async function signupWorkSettled(): Promise<void> {
  await Promise.all([...inFlight])
}

const SENT = '/signup?status=sent'

async function handleRequest(request: Request, form: FormData | null): Promise<Response> {
  if (getConfig().signup !== 'open') return seeOther('/signup')
  if (await sessionForRequest(request)) return seeOther('/signup')
  const input = form ? parseSignupRequest(form) : null
  const ip = requestIp(request)
  try {
    if (input?.honeypot) {
      await recordEvent(getDb(), 'signup.requested', { ip, detail: { outcome: 'honeypot', existing: 0 } })
      return seeOther(SENT)
    }
    if (!input?.email) return seeOther('/signup?error=invalid')
    const db = getDb()
    if (ip) {
      const now = new Date()
      const times = await ipEventTimes(db, ip, 'signup.requested', new Date(now.getTime() - SIGNUP_IP_LIMIT.windowMs))
      if (overLimit(times, SIGNUP_IP_LIMIT, now)) return seeOther('/signup?error=limited')
    }
    if ((await dailySignupCount(db)) >= SIGNUP_DAILY_LIMIT.max) return seeOther('/signup?error=busy')
    const work = requestLink(input.email, ip)
      .catch((error) => logError('sign-up request', error))
      .finally(() => inFlight.delete(work))
    inFlight.add(work)
    return seeOther(SENT)
  } catch (error) {
    logError('sign-up request', error)
    return seeOther('/signup?error=unavailable')
  }
}

async function handleFinish(request: Request, form: FormData): Promise<Response> {
  const input = parseSignupFinish(form)
  const token = form.get('token')
  if (typeof token !== 'string' || !isWellFormedToken(token)) return seeOther('/signup')
  const page = `/signup?token=${token}`
  if (getConfig().signup === 'off' || (await sessionForRequest(request))) return seeOther(page)
  if (!input) return seeOther(`${page}&error=unavailable`)
  const back = (error: string, extra: Record<string, string> = {}) =>
    seeOther(`${page}&${new URLSearchParams({ error, ...extra, username: input.username.slice(0, 32) })}`)
  const ip = requestIp(request)
  try {
    const db = getDb()
    const tokenHash = hashToken(token)
    const live = await findLiveSignupToken(db, tokenHash)
    if (!live || !kindAllowed(live.kind)) return seeOther(page)

    const refuse = async (reason: 'username' | 'taken' | 'policy' | 'mismatch', attempts?: number) =>
      recordEvent(db, 'signup.refused', {
        ip,
        detail: { kind: live.kind, reason, attempts: attempts ?? (await countRefusal(db, live.id)) },
      })
    const nameProblem = usernameProblem(input.username)
    if (nameProblem) {
      await refuse(nameProblem)
      return back(nameProblem)
    }
    const problem = passwordProblem(input.password, input.username)
    if (problem) {
      await refuse('policy')
      return back('policy', { reason: problem })
    }
    if (input.confirm !== input.password) {
      await refuse('mismatch')
      return back('mismatch')
    }

    const passwordHash = await hashPassword(input.password)
    const created = await createAccountFromToken(db, { tokenHash, username: input.username, passwordHash, ip })
    if (created.outcome === 'gone') return seeOther(page)
    if (created.outcome === 'taken') {
      await refuse('taken', created.attempts)
      return back('taken')
    }
    const cookie = await startSession(db, request, created.user.id)
    await recordEvent(db, 'login.succeeded', { userId: created.user.id, ip, detail: { via: 'sign-up' } })
    return seeOther('/account?status=welcome', { 'set-cookie': cookie })
  } catch (error) {
    logError('sign-up finish', error)
    return back('unavailable')
  }
}

export async function handleSignup(request: Request): Promise<Response> {
  if (!isSameOrigin(request.headers, getConfig().appOrigin)) return forbidden()
  const form = await readForm(request)
  if (form?.has('token')) return handleFinish(request, form)
  return handleRequest(request, form)
}

export type SignupPage =
  | { state: 'off' | 'invite-only' | 'request' | 'invalid' | 'closed' | 'unavailable' }
  | { state: 'signed-in'; username: string }
  | { state: 'ready'; kind: SignupKind; email: string | null }

const NO_TOKEN_STATE: Record<SignupMode, 'off' | 'invite-only' | 'request'> = {
  off: 'off',
  invite: 'invite-only',
  open: 'request',
}

export async function signupPage(request: Request, token: string | undefined): Promise<SignupPage> {
  const session = await sessionForRequest(request)
  if (session) return { state: 'signed-in', username: session.username }
  const mode = isDatabaseConfigured() ? getConfig().signup : 'off'
  if (token === undefined) return { state: NO_TOKEN_STATE[mode] }
  if (mode === 'off') return { state: 'closed' }
  if (!isWellFormedToken(token)) return { state: 'invalid' }
  try {
    const live = await findLiveSignupToken(getDb(), hashToken(token))
    if (!live) return { state: 'invalid' }
    if (!kindAllowed(live.kind)) return { state: 'closed' }
    return { state: 'ready', kind: live.kind, email: live.kind === 'email' ? live.email : null }
  } catch (error) {
    logError('sign-up page', error)
    return { state: 'unavailable' }
  }
}
