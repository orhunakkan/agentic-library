const PRIVATE_PATH =
  /^\/(login|logout|account|passkeys|api|read\/u-[^/]+|offline\/u-[^/]+|confirm-email|forgot-password|reset-password|signup)(\/|$)/
const TOKEN_PATH = /^\/(confirm-email|forgot-password|reset-password|signup)\/?$/
const SESSION_COOKIE = /(^|;\s*)(__Host-session|session)=/

export function privateHeaders(pathname: string, cookie: string | null): Record<string, string> | null {
  if (!PRIVATE_PATH.test(pathname) && !SESSION_COOKIE.test(cookie ?? '')) return null
  return {
    'cache-control': 'private, no-store',
    ...(TOKEN_PATH.test(pathname) ? { 'referrer-policy': 'strict-origin' } : {}),
  }
}
