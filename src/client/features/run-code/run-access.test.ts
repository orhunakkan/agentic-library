import { describe, expect, it } from 'vitest'
import { runAccess } from './run-access'

describe('runAccess', () => {
  it('lets any signed-in reader run, and asks the signed-out reader to sign in', () => {
    expect(runAccess({ username: 'reader', role: 'member' })).toBe('signed_in')
    expect(runAccess(null)).toBe('signed_out')
    expect(runAccess(undefined)).toBe('signed_out')
  })
})
