import { hasPrivateSlugPrefix } from '../shared/content/book-slug.ts'

const PRIVATE_PATH = /^\/(login|logout|account|passkeys|api|confirm-email|forgot-password|reset-password|signup)(\/|$)/
const BOOK_PATH = /^\/(?:read|offline)\/([^/]+)/
const TOKEN_PATH = /^\/(confirm-email|forgot-password|reset-password|signup)\/?$/
const SESSION_COOKIE = /(^|;\s*)(__Host-session|session)=/

export function privateHeaders(pathname: string, cookie: string | null): Record<string, string> | null {
  const book = BOOK_PATH.exec(pathname)?.[1]
  const privatePath = PRIVATE_PATH.test(pathname) || (book !== undefined && hasPrivateSlugPrefix(book))
  if (!privatePath && !SESSION_COOKIE.test(cookie ?? '')) return null
  return {
    'cache-control': 'private, no-store',
    ...(TOKEN_PATH.test(pathname) ? { 'referrer-policy': 'strict-origin' } : {}),
  }
}
