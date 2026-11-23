import { createHash, randomBytes } from 'node:crypto'
import { isIP } from 'node:net'

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest()
}

export function isWellFormedToken(value: string | undefined | null): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value)
}

export function newAccessToken(): string {
  return `folio_at_${randomBytes(32).toString('base64url')}`
}

export function isWellFormedAccessToken(value: string | undefined | null): value is string {
  return typeof value === 'string' && /^folio_at_[A-Za-z0-9_-]{43}$/.test(value)
}

export function isSameOrigin(headers: Headers, appOrigin: string): boolean {
  const origin = headers.get('origin')
  if (origin !== null) return origin === appOrigin
  return headers.get('sec-fetch-site') === 'same-origin'
}

export function clientIp(headers: Headers, socketIp?: string | null): string | null {
  const real = headers.get('x-real-ip')?.trim()
  if (real && isIP(real)) return real
  const socket = socketIp?.replace(/^::ffff:/, '')
  return socket && isIP(socket) ? socket : null
}
