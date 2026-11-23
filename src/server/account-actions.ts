import '@tanstack/react-start/server-only'
import { isAiModel } from '../shared/lib/ai-models.ts'
import { DEFAULT_AFTER_SIGN_IN, safeNext } from '../shared/lib/safe-next.ts'
import { isSpeechModel } from '../shared/lib/speech-models.ts'
import { canUse } from '../shared/plans/plans.ts'
import { isTokenId } from './access-tokens/input.ts'
import { endedDetail, endUserAccess, revokeAccessToken } from './access-tokens/store.ts'
import { deleteAccount } from './admin/store.ts'
import { checkAnthropicKey, isAnthropicKeyShape } from './anthropic.ts'
import { deleteKey, PROVIDERS, type Provider, saveKey } from './api-keys.ts'
import { eventTimes, recordEvent } from './audit.ts'
import {
  clearSessionCookie,
  forbidden,
  readSessionToken,
  requestIp,
  seeOther,
  sessionCookie,
  sessionForRequest,
} from './auth.ts'
import { getConfig } from './config.ts'
import { checkCurrentPassword } from './current-password.ts'
import { type Db, getDb, isDatabaseConfigured } from './db.ts'
import { handleEmailForm } from './email/actions.ts'
import { readForm } from './json-body.ts'
import { parsePasskeyId } from './passkeys/input.ts'
import { removePasskey } from './passkeys/store.ts'
import { hashPassword, passwordProblem } from './passwords.ts'
import { API_KEY_LIMIT, overLimit } from './rate-limit.ts'
import { logError } from './redact.ts'
import { hashToken, isSameOrigin, newSessionToken } from './security.ts'
import { createSession, deleteSession } from './sessions.ts'
import { checkSignIn, finishSignIn } from './sign-in.ts'
import { signedInForm } from './signed-in.ts'
import { checkKey as checkElevenLabsKey, elevenLabsKeyProblem } from './speech/elevenlabs.ts'
import { normalizeUsername, setAiModel, setPasswordHash, setSpeechModel } from './users.ts'

const field = (form: FormData, name: string) => {
  const value = form.get(name)
  return typeof value === 'string' ? value : ''
}

function loginError(code: 'invalid' | 'unavailable', next: string) {
  const query = new URLSearchParams({ error: code })
  if (next !== DEFAULT_AFTER_SIGN_IN) query.set('next', next)
  return seeOther(`/login?${query}`)
}

export async function startSession(db: Db, request: Request, userId: number): Promise<string> {
  const previous = readSessionToken(request.headers)
  if (previous) await deleteSession(db, hashToken(previous))
  const token = newSessionToken()
  const { expiresAt } = await createSession(db, {
    tokenHash: hashToken(token),
    userId,
    ip: requestIp(request),
    userAgent: request.headers.get('user-agent') ?? '',
  })
  return sessionCookie(token, (expiresAt.getTime() - Date.now()) / 1000)
}

export async function handleLogin(request: Request): Promise<Response> {
  if (!isSameOrigin(request.headers, getConfig().appOrigin)) return forbidden()
  const form = await readForm(request)
  const next = safeNext(form && field(form, 'next'))
  if (!form || !isDatabaseConfigured()) return loginError(form ? 'unavailable' : 'invalid', next)

  const username = normalizeUsername(field(form, 'username')).slice(0, 64)
  const password = field(form, 'password')
  const ip = requestIp(request)
  const db = getDb()
  try {
    const check = await checkSignIn(db, { username, password, ip })
    if (!check.ok) return loginError('invalid', next)
    const cookie = await startSession(db, request, check.user.id)
    await finishSignIn(db, { attempt: check.attempt, userId: check.user.id, ip })
    return seeOther(next, { 'set-cookie': cookie })
  } catch (error) {
    logError('sign-in', error)
    return loginError('unavailable', next)
  }
}

export async function handleLogout(request: Request): Promise<Response> {
  if (!isSameOrigin(request.headers, getConfig().appOrigin)) return forbidden()
  const token = readSessionToken(request.headers)
  if (token && isDatabaseConfigured()) {
    try {
      const db = getDb()
      const session = await sessionForRequest(request)
      await deleteSession(db, hashToken(token))
      if (session) await recordEvent(db, 'logout', { userId: session.userId, ip: requestIp(request) })
    } catch (error) {
      logError('sign-out', error)
    }
  }
  return seeOther(DEFAULT_AFTER_SIGN_IN, { 'set-cookie': clearSessionCookie() })
}

export const handleAccount = (request: Request) =>
  signedInForm(request, { log: 'account', next: '/account' }, async ({ session, db, form }) => {
    const ip = requestIp(request)
    const current = hashToken(readSessionToken(request.headers) as string)
    switch (field(form, 'intent')) {
      case 'change-password': {
        const password = field(form, 'password')
        if (password !== field(form, 'confirm')) return seeOther('/account?error=mismatch#password')
        const problem = passwordProblem(password, session.username)
        if (problem) return seeOther(`/account?error=policy&reason=${problem}#password`)
        if (!(await checkCurrentPassword(db, session, field(form, 'current'), ip, 'change password')))
          return seeOther('/account?error=current#password')
        await setPasswordHash(db, session.userId, await hashPassword(password))
        const ended = await endUserAccess(db, session.userId, { keep: current, via: 'password change', ip })
        await recordEvent(db, 'password.changed', { userId: session.userId, ip, detail: endedDetail(ended) })
        return seeOther('/account?status=password-changed')
      }
      case 'revoke-others': {
        const ended = await endUserAccess(db, session.userId, { keep: current, via: 'sign out everywhere', ip })
        await recordEvent(db, 'sessions.revoked', { userId: session.userId, ip, detail: endedDetail(ended) })
        return seeOther('/account?status=signed-out-others#sessions')
      }
      case 'token-revoke': {
        const id = field(form, 'token')
        if (isTokenId(id) && (await revokeAccessToken(db, session.userId, id)))
          await recordEvent(db, 'token.revoked', { userId: session.userId, ip, detail: { id, via: 'account page' } })
        return seeOther('/account?status=token-revoked#access-tokens')
      }
      case 'delete-account': {
        if (!(await checkCurrentPassword(db, session, field(form, 'current'), ip, 'delete account')))
          return seeOther('/account?error=delete-current#delete')
        const result = await deleteAccount(db, session.userId, { ip, detail: { via: 'account page' } })
        if (result === 'last_admin') return seeOther('/account?error=last-admin#delete')
        if (result === 'billing_failed') return seeOther('/account?error=delete-billing#delete')
        return seeOther('/login?status=account-deleted', { 'set-cookie': clearSessionCookie() })
      }
      case 'passkey-remove': {
        const id = parsePasskeyId(field(form, 'passkey'))
        if (id && (await removePasskey(db, session.userId, id)))
          await recordEvent(db, 'passkey.removed', { userId: session.userId, ip, detail: { via: 'account' } })
        return seeOther('/account?status=passkey-removed#passkeys')
      }
      case 'email-add':
      case 'email-resend':
      case 'email-remove':
        return await handleEmailForm(session, form, ip, (password) =>
          checkCurrentPassword(db, session, password, ip, 'email'),
        )
      default:
        return seeOther('/account?error=invalid')
    }
  })

async function saveModel(db: Db, userId: number, ip: string | null, value: string): Promise<Response> {
  if (!isAiModel(value)) return seeOther('/account/api-keys?error=invalid#model')
  const previous = await setAiModel(db, userId, value)
  if (previous !== value)
    await recordEvent(db, 'ai_model.changed', { userId, ip, detail: { from: previous, to: value } })
  return seeOther('/account/api-keys?status=model-saved#model')
}

const speechModelBack = (query: string) => seeOther(`/account/api-keys?${query}&provider=elevenlabs#speech-model`)

async function saveSpeechModel(db: Db, userId: number, ip: string | null, value: string): Promise<Response> {
  if (!isSpeechModel(value)) return speechModelBack('error=invalid')
  const previous = await setSpeechModel(db, userId, value)
  if (previous !== value)
    await recordEvent(db, 'speech_model.changed', { userId, ip, detail: { from: previous, to: value } })
  return speechModelBack('status=speech-model-saved')
}

export interface ApiKeysOptions {
  fetch?: typeof fetch
}

async function checkProviderKey(
  provider: Provider,
  key: string,
  options: ApiKeysOptions,
): Promise<
  { problem: 'shape' | 'anthropic' } | { result: 'valid' | 'rejected' | 'permission' | 'unavailable'; status?: number }
> {
  if (provider === 'anthropic') {
    if (!isAnthropicKeyShape(key)) return { problem: 'shape' }
    return checkAnthropicKey(key, getConfig().anthropicApiBase, options.fetch)
  }
  const problem = elevenLabsKeyProblem(key)
  if (problem) return { problem }
  return checkElevenLabsKey(key, { fetch: options.fetch })
}

export function handleApiKeys(request: Request, options: ApiKeysOptions = {}): Promise<Response> {
  const page = '/account/api-keys'
  const back = (provider: string, query: string) => seeOther(`${page}?${query}&provider=${provider}#${provider}`)
  const failed = (form: FormData) => {
    const intent = field(form, 'intent')
    if (intent === 'model') return seeOther(`${page}?error=failed#model`)
    if (intent === 'speech-model') return speechModelBack('error=failed')
    return back(field(form, 'provider'), 'error=failed')
  }
  return signedInForm(request, { log: 'api keys', next: page, failed }, async ({ session, db, form }) => {
    const intent = field(form, 'intent')
    const ip = requestIp(request)
    if (intent === 'model') return saveModel(db, session.userId, ip, field(form, 'model'))
    if (intent === 'speech-model') return saveSpeechModel(db, session.userId, ip, field(form, 'model'))
    const provider = field(form, 'provider') as Provider
    if (!PROVIDERS.includes(provider)) return seeOther(`${page}?error=invalid`)
    const recent = await eventTimes(
      db,
      session.userId,
      ['api_key.saved', 'api_key.deleted', 'api_key.rejected'],
      new Date(Date.now() - API_KEY_LIMIT.windowMs),
    )
    if (overLimit(recent, API_KEY_LIMIT, new Date())) return back(provider, 'error=limit')

    switch (intent) {
      case 'save': {
        if (provider === 'elevenlabs' && !canUse(session.plan, 'elevenlabs')) return back(provider, 'error=pro')
        const key = field(form, 'key').trim()
        const check = await checkProviderKey(provider, key, options)
        if ('problem' in check) return back(provider, `error=${check.problem}`)
        if (check.result === 'rejected' || check.result === 'permission') {
          await recordEvent(db, 'api_key.rejected', { userId: session.userId, ip, detail: { provider } })
          return back(provider, `error=${check.result}`)
        }
        if (check.result !== 'valid') {
          logError('api key check', `${provider} check failed with status ${check.status ?? 'none'}`)
          return back(provider, 'error=unavailable')
        }
        await saveKey(db, session.userId, provider, key)
        await recordEvent(db, 'api_key.saved', { userId: session.userId, ip, detail: { provider } })
        return back(provider, 'status=saved')
      }
      case 'delete': {
        if (await deleteKey(db, session.userId, provider))
          await recordEvent(db, 'api_key.deleted', { userId: session.userId, ip, detail: { provider } })
        return back(provider, 'status=deleted')
      }
      default:
        return back(provider, 'error=invalid')
    }
  })
}
