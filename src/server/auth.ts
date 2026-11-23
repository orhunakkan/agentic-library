import '@tanstack/react-start/server-only'
import type { Plan } from '../shared/plans/plans.ts'
import { parseAuthorization } from './access-tokens/input.ts'
import { findAccessToken, type TokenUser } from './access-tokens/store.ts'
import { getConfig } from './config.ts'
import { getDb, isDatabaseConfigured } from './db.ts'
import { logError } from './redact.ts'
import { clientIp, hashToken, isSameOrigin, isWellFormedToken } from './security.ts'
import { findSession, type SessionUser } from './sessions.ts'
import { signedInEndpoints } from './signed-in.ts'
import type { Role } from './users.ts'

export interface Viewer {
  username: string
  role: Role
  plan: Plan
}

export const NO_STORE = 'private, no-store'

export function sessionCookieName(secure = getConfig().cookieSecure): string {
  return secure ? '__Host-session' : 'session'
}

export function readCookie(headers: Headers, name: string): string | undefined {
  for (const part of (headers.get('cookie') ?? '').split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return undefined
}

export function readSessionToken(headers: Headers): string | undefined {
  const token = readCookie(headers, sessionCookieName())
  return isWellFormedToken(token) ? token : undefined
}

export function sessionCookie(token: string, maxAgeSeconds: number): string {
  const secure = getConfig().cookieSecure
  return [
    `${sessionCookieName(secure)}=${token}`,
    'Path=/',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
    'HttpOnly',
    'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
  ].join('; ')
}

export function clearSessionCookie(): string {
  return sessionCookie('', 0)
}

export function requestIp(request: Request): string | null {
  return clientIp(request.headers, (request as Request & { ip?: string }).ip)
}

const lookups = new WeakMap<Request, Promise<SessionUser | null>>()

export function sessionForRequest(request: Request): Promise<SessionUser | null> {
  let lookup = lookups.get(request)
  if (!lookup) {
    const token = readSessionToken(request.headers)
    lookup =
      !token || !isDatabaseConfigured()
        ? Promise.resolve(null)
        : findSession(getDb(), hashToken(token)).catch((error) => {
            logError('session lookup', error)
            return null
          })
    lookups.set(request, lookup)
  }
  return lookup
}

export type Caller = { ok: true; session: SessionUser } | { ok: false; response: Response }

export async function signedInCaller(request: Request, signedOut: () => Response): Promise<Caller> {
  if (!isSameOrigin(request.headers, getConfig().appOrigin)) return { ok: false, response: forbidden() }
  const session = await sessionForRequest(request)
  return session ? { ok: true, session } : { ok: false, response: signedOut() }
}

const tokenLookups = new WeakMap<Request, Promise<TokenUser | null>>()

function tokenForRequest(request: Request, token: string): Promise<TokenUser | null> {
  let lookup = tokenLookups.get(request)
  if (!lookup) {
    lookup = !isDatabaseConfigured()
      ? Promise.resolve(null)
      : findAccessToken(getDb(), hashToken(token)).catch((error) => {
          logError('access token lookup', error)
          return null
        })
    tokenLookups.set(request, lookup)
  }
  return lookup
}

export type ApiCaller =
  | { ok: true; session: SessionUser; via: 'cookie' | 'token'; tokenId: string | null }
  | { ok: false; response: Response }

function challenged(response: Response, invalidToken: boolean): Response {
  response.headers.set('www-authenticate', invalidToken ? 'Bearer error="invalid_token"' : 'Bearer')
  return response
}

export async function apiCaller(request: Request, signedOut: () => Response): Promise<ApiCaller> {
  const auth = parseAuthorization(request.headers.get('authorization'))
  const appOrigin = getConfig().appOrigin
  if (auth.kind === 'none') {
    if (request.method !== 'GET' && !isSameOrigin(request.headers, appOrigin))
      return { ok: false, response: forbidden() }
    const session = await sessionForRequest(request)
    return session
      ? { ok: true, session, via: 'cookie', tokenId: null }
      : { ok: false, response: challenged(signedOut(), false) }
  }
  const origin = request.headers.get('origin')
  if (origin !== null && origin !== appOrigin) return { ok: false, response: forbidden() }
  if (auth.kind === 'invalid') return { ok: false, response: challenged(signedOut(), auth.bearer) }
  const user = await tokenForRequest(request, auth.token)
  if (!user) return { ok: false, response: challenged(signedOut(), true) }
  const { tokenId, ...session } = user
  return { ok: true, session, via: 'token', tokenId }
}

export function handleMe(request: Request): Promise<Response> {
  return signedInEndpoints({ via: 'api', maxBytes: 0 }).post(
    request,
    { log: 'me', body: 'none' },
    async ({ session: { username, role, plan }, via }) => noStoreJson(200, { username, role, plan, via }),
  )
}

export async function viewerForRequest(request: Request): Promise<Viewer | null> {
  const session = await sessionForRequest(request)
  return session && { username: session.username, role: session.role, plan: session.plan }
}

export function seeOther(location: string, headers: Record<string, string> = {}): Response {
  return new Response(null, { status: 303, headers: { location, 'cache-control': NO_STORE, ...headers } })
}

export function noStoreJson(status: number, body: object): Response {
  return Response.json(body, { status, headers: { 'cache-control': NO_STORE } })
}

export function noStoreText(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': NO_STORE },
  })
}

export function toSignIn(next: string): Response {
  return new Response(null, { status: 302, headers: { location: loginHref(next), 'cache-control': NO_STORE } })
}

export function forbidden(): Response {
  return new Response('Forbidden', {
    status: 403,
    headers: { 'content-type': 'text/plain', 'cache-control': NO_STORE },
  })
}

export function loginHref(next: string): string {
  return `/login?next=${encodeURIComponent(next)}`
}
