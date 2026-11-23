import '@tanstack/react-start/server-only'
import { recordEvent } from '../audit.ts'
import { forbidden, noStoreJson, requestIp } from '../auth.ts'
import { getConfig } from '../config.ts'
import { getDb, isDatabaseConfigured } from '../db.ts'
import { readJsonOr } from '../json-body.ts'
import { markSucceeded } from '../login-attempts.ts'
import { logError } from '../redact.ts'
import { hashToken, newAccessToken } from '../security.ts'
import { checkSignIn, finishSignIn } from '../sign-in.ts'
import { signedInEndpoints } from '../signed-in.ts'
import { normalizeUsername } from '../users.ts'
import { isTokenId, parseTokenCreate, parseTokenRevoke } from './input.ts'
import {
  createAccessToken,
  listAccessTokens,
  MAX_ACCESS_TOKENS,
  revokeAccessToken,
  sweepAccessTokens,
} from './store.ts'
import { toAccessTokenView } from './view.ts'

const MAX_CREATE_BYTES = 8 * 1024
const MAX_REVOKE_BYTES = 1024

export type TokenProblem =
  | 'invalid'
  | 'invalid_credentials'
  | 'limited'
  | 'quota'
  | 'signed_out'
  | 'not_found'
  | 'unavailable'
  | 'failed'

const tokens = signedInEndpoints<TokenProblem>({ via: 'api', maxBytes: MAX_REVOKE_BYTES })
const { fail } = tokens

export async function handleTokenCreate(request: Request): Promise<Response> {
  const origin = request.headers.get('origin')
  if (origin !== null && origin !== getConfig().appOrigin) return forbidden()
  if (!isDatabaseConfigured()) return fail(503, 'unavailable')
  const body = await readJsonOr(request, MAX_CREATE_BYTES, (status) => fail(status, 'invalid'))
  if (!body.ok) return body.response
  const input = parseTokenCreate(body.value)
  if (!input) return fail(400, 'invalid')
  const db = getDb()
  const ip = requestIp(request)
  try {
    const username = normalizeUsername(input.username).slice(0, 64)
    const check = await checkSignIn(db, { username, password: input.password, ip, via: 'token' })
    if (!check.ok) return check.refusal === 'ip blocked' ? fail(429, 'limited') : fail(401, 'invalid_credentials')
    const token = newAccessToken()
    const made = await createAccessToken(db, {
      userId: check.user.id,
      tokenHash: hashToken(token),
      name: input.name,
      days: input.days,
      ip,
      userAgent: request.headers.get('user-agent') ?? '',
    })
    if (made === 'quota') {
      await markSucceeded(db, check.attempt)
      return fail(409, 'quota', { max: MAX_ACCESS_TOKENS })
    }
    await finishSignIn(db, { attempt: check.attempt, userId: check.user.id, ip, via: 'token' })
    await recordEvent(db, 'token.created', {
      userId: check.user.id,
      ip,
      detail: { id: made.id, name: made.name, expiresAt: made.expiresAt.toISOString() },
    })
    void sweepAccessTokens(db).catch((error) => logError('access token sweep', error))
    return noStoreJson(201, {
      token,
      tokenType: 'Bearer',
      expiresAt: made.expiresAt.toISOString(),
      id: made.id,
      name: made.name,
    })
  } catch (error) {
    logError('access token create', error)
    return fail(500, 'failed')
  }
}

export const handleTokenList = (request: Request) =>
  tokens.post(request, { log: 'access token list', body: 'none' }, async ({ session, db, tokenId }) => {
    const rows = await listAccessTokens(db, session.userId)
    return noStoreJson(200, { tokens: rows.map((row) => toAccessTokenView(row, tokenId)) })
  })

export const handleTokenRevoke = (request: Request, id: string) =>
  tokens.post(
    request,
    {
      log: 'access token revoke',
      before: ({ tokenId }) => {
        const target = id === 'current' ? tokenId : id
        return target !== null && isTokenId(target) ? target : fail(404, 'not_found')
      },
      parse: (value) => parseTokenRevoke(value) || null,
    },
    async ({ session, db, pre: target }) => {
      if (!(await revokeAccessToken(db, session.userId, target))) return fail(404, 'not_found')
      await recordEvent(db, 'token.revoked', {
        userId: session.userId,
        ip: requestIp(request),
        detail: { id: target, via: 'self' },
      })
      return noStoreJson(200, { revoked: true })
    },
  )
