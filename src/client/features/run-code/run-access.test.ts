import { describe, expect, it } from 'vitest'
import { runAccess } from './run-access'

describe('runAccess', () => {
  it('lets Pro run, shows Free the Pro notice and asks the signed-out reader to sign in', () => {
    expect(runAccess({ plan: 'pro' })).toBe('pro')
    expect(runAccess({ plan: 'free' })).toBe('free')
    expect(runAccess(null)).toBe('signed_out')
    expect(runAccess(undefined)).toBe('signed_out')
  })
})
