import { shortDate } from '~/shared/lib/site'

export const ACCESS_TOKENS_INTRO =
  'Access tokens let a script or test client use Folio’s API without a browser. They’re made with your username and ' +
  'password, and changing your password or signing out everywhere else ends them all.'

export const ACCESS_TOKENS_EMPTY = 'You have no access tokens.'

export const ACCESS_TOKEN_REVOKED = 'Access token revoked.'

export function tokenUseText(token: { createdAt: string; lastUsedAt: string | null }): string {
  const used = token.lastUsedAt ? `Last used ${shortDate(token.lastUsedAt)}` : 'Never used'
  return `Created ${shortDate(token.createdAt)} · ${used}`
}

export function tokenExpiryText(token: { expiresAt: string }): string {
  return `Expires ${shortDate(token.expiresAt)}`
}
