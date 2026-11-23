import { describe, expect, it } from 'vitest'
import { addProblemText, NETWORK_TEXT, signInProblemText, UNAVAILABLE_TEXT } from './passkey-problems'

const server = <P extends string>(code: P) => ({ kind: 'server' as const, code })
const browser = (name: string) => ({ kind: 'browser' as const, name })

describe('adding a passkey', () => {
  it('has a sentence for every server code', () => {
    expect(addProblemText(server('password'))).toBe('Your password is incorrect.')
    expect(addProblemText(server('quota'))).toBe(
      'You have 10 passkeys, the most an account can have. Remove one to add another.',
    )
    expect(addProblemText(server('expired'))).toBe('That took too long. Try again.')
    expect(addProblemText(server('taken'))).toBe('This passkey is already set up for a Folio account.')
    expect(addProblemText(server('refused'))).toBe('Folio couldn’t check that passkey. Try again.')
    expect(addProblemText(server('invalid'))).toBe('Folio couldn’t check that passkey. Try again.')
    expect(addProblemText(server('failed'))).toBe('Folio couldn’t check that passkey. Try again.')
    expect(addProblemText(server('network'))).toBe('Couldn’t reach Folio. Check your connection and try again.')
    expect(addProblemText(server('signed_out'))).toBe('You’ve been signed out. Sign in again to add a passkey.')
  })

  it('says nothing when the reader cancelled, and names a device that has one already', () => {
    expect(addProblemText(browser('NotAllowedError'))).toBeNull()
    expect(addProblemText(browser('AbortError'))).toBeNull()
    expect(addProblemText(browser('InvalidStateError'))).toBe('This device already has a passkey for your account.')
    expect(addProblemText(browser('SecurityError'))).toBe('Folio couldn’t check that passkey. Try again.')
  })
})

describe('signing in with a passkey', () => {
  it('has a sentence for every server code', () => {
    expect(signInProblemText(server('refused'))).toBe(
      'That passkey didn’t work. Try again, or sign in with your password.',
    )
    expect(signInProblemText(server('invalid'))).toBe(
      'That passkey didn’t work. Try again, or sign in with your password.',
    )
    expect(signInProblemText(server('limited'))).toBe(
      'Too many sign-in attempts from this network. Try again in 15 minutes.',
    )
    expect(signInProblemText(server('unavailable'))).toBe(UNAVAILABLE_TEXT)
    expect(UNAVAILABLE_TEXT).toBe('Signing in isn’t working right now. Try again in a few minutes.')
    expect(signInProblemText(server('network'))).toBe(NETWORK_TEXT)
  })

  it('says nothing when the reader cancelled or it timed out', () => {
    expect(signInProblemText(browser('NotAllowedError'))).toBeNull()
    expect(signInProblemText(browser('AbortError'))).toBeNull()
    expect(signInProblemText(browser('SecurityError'))).toBe(
      'That passkey didn’t work. Try again, or sign in with your password.',
    )
  })
})
