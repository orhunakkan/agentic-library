import { describe, expect, it } from 'vitest'
import {
  ACCESS_TOKEN_REVOKED,
  ACCESS_TOKENS_EMPTY,
  ACCESS_TOKENS_INTRO,
  tokenExpiryText,
  tokenUseText,
} from '~/client/features/account/access-token-text'

describe('the Access tokens section’s copy', () => {
  it('says when a token was made and last used, or that it never was', () => {
    expect(tokenUseText({ createdAt: '2026-11-18T09:00:00.000Z', lastUsedAt: '2026-11-20T23:59:00.000Z' })).toBe(
      'Created 18 Nov 2026 · Last used 20 Nov 2026',
    )
    expect(tokenUseText({ createdAt: '2026-11-18T09:00:00.000Z', lastUsedAt: null })).toBe(
      'Created 18 Nov 2026 · Never used',
    )
  })

  it('says when it expires', () => {
    expect(tokenExpiryText({ expiresAt: '2026-12-18T09:00:00.000Z' })).toBe('Expires 18 Dec 2026')
  })

  it('has its fixed sentences', () => {
    expect(ACCESS_TOKENS_INTRO).toBe(
      'Access tokens let a script or test client use Folio’s API without a browser. They’re made with your username ' +
        'and password, and changing your password or signing out everywhere else ends them all.',
    )
    expect(ACCESS_TOKENS_EMPTY).toBe('You have no access tokens.')
    expect(ACCESS_TOKEN_REVOKED).toBe('Access token revoked.')
  })
})
