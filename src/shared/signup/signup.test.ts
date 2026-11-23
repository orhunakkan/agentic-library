import { describe, expect, it } from 'vitest'
import {
  isReservedSignupName,
  RESERVED_SIGNUP_NAMES,
  SIGNUP_ERRORS,
  SIGNUP_MODES,
  signInFooter,
  USERNAME_PATTERN,
} from './signup'

describe('signInFooter', () => {
  it('says how accounts are made in each mode, with and without mail', () => {
    expect(signInFooter('off', true)).toEqual({
      text: 'Accounts are created by the site’s owner. There is no sign-up.',
    })
    expect(signInFooter('off', false)).toEqual({
      text: 'Accounts are created by the site’s owner. There is no sign-up, and the owner resets forgotten passwords.',
    })
    expect(signInFooter('invite', true)).toEqual({
      text: 'Accounts are by invitation: the site’s owner sends you a link to create one.',
    })
    expect(signInFooter('invite', false)).toEqual({
      text: 'Accounts are by invitation: the site’s owner sends you a link to create one. The owner also resets forgotten passwords.',
    })
  })

  it('links to /signup when sign-up is open, whatever mail says', () => {
    for (const mail of [true, false])
      expect(signInFooter('open', mail)).toEqual({
        text: 'New to Folio?',
        link: { label: 'Create an account', href: '/signup' },
      })
  })
})

describe('the reserved names', () => {
  it('are lowercase usernames, each once', () => {
    for (const name of RESERVED_SIGNUP_NAMES) {
      expect(name).toBe(name.toLowerCase())
      expect(USERNAME_PATTERN.test(name), name).toBe(true)
    }
    expect(new Set(RESERVED_SIGNUP_NAMES).size).toBe(RESERVED_SIGNUP_NAMES.length)
  })

  it('include the names the site seems to speak for, and not ordinary ones', () => {
    for (const name of ['admin', 'folio', 'no-reply', 'new']) expect(isReservedSignupName(name)).toBe(true)
    for (const name of ['orhun', 'tester', 'ann']) expect(isReservedSignupName(name)).toBe(false)
  })
})

describe('the codes', () => {
  it('list the modes and each error once', () => {
    expect(SIGNUP_MODES).toEqual(['off', 'invite', 'open'])
    expect(new Set(SIGNUP_ERRORS).size).toBe(SIGNUP_ERRORS.length)
    expect(SIGNUP_ERRORS).toContain('unavailable')
  })
})
