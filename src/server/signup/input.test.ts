import { describe, expect, it } from 'vitest'
import { RESERVED_SIGNUP_NAMES } from '~/shared/signup/signup'
import {
  MAX_FIELD,
  parseInviteChange,
  parseInviteNote,
  parseNewInvite,
  parseSignupFinish,
  parseSignupRequest,
  usernameProblem,
} from './input'

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [name, value] of Object.entries(fields)) data.set(name, value)
  return data
}

describe('parseSignupRequest', () => {
  it('tidies the address and sees an empty honeypot', () => {
    expect(parseSignupRequest(form({ email: ' Ann@Example.COM ', website: '' }))).toEqual({
      email: 'Ann@example.com',
      honeypot: false,
    })
  })

  it('refuses what isn’t an address, and an over-long field', () => {
    expect(parseSignupRequest(form({ email: 'ann' })).email).toBeNull()
    expect(parseSignupRequest(form({})).email).toBeNull()
    expect(parseSignupRequest(form({ email: `${'a'.repeat(MAX_FIELD)}@example.com` })).email).toBeNull()
  })

  it('sees a filled honeypot, even beside a good address', () => {
    expect(parseSignupRequest(form({ email: 'ann@example.com', website: 'https://spam.example' }))).toEqual({
      email: 'ann@example.com',
      honeypot: true,
    })
    expect(parseSignupRequest(form({ email: 'ann@example.com', website: '   ' })).honeypot).toBe(false)
  })
})

describe('parseSignupFinish', () => {
  it('lowercases and trims the username, and keeps the passwords as typed', () => {
    expect(
      parseSignupFinish(form({ token: 't', username: '  Ann_1 ', password: ' pass word ', confirm: ' pass word ' })),
    ).toEqual({ token: 't', username: 'ann_1', password: ' pass word ', confirm: ' pass word ' })
  })

  it('treats missing fields as empty', () => {
    expect(parseSignupFinish(form({}))).toEqual({ token: '', username: '', password: '', confirm: '' })
  })

  it('refuses any field over 1,024 characters', () => {
    for (const name of ['token', 'username', 'password', 'confirm'])
      expect(parseSignupFinish(form({ [name]: 'x'.repeat(MAX_FIELD + 1) })), name).toBeNull()
    expect(parseSignupFinish(form({ password: 'x'.repeat(MAX_FIELD) }))).not.toBeNull()
  })
})

describe('usernameProblem', () => {
  it('passes ordinary names', () => {
    for (const name of ['orhun', 'tester', 'ann', 'a-b_c', '007', 'x'.repeat(32)])
      expect(usernameProblem(name)).toBe(null)
  })

  it('refuses names outside the pattern', () => {
    for (const name of ['', 'ab', 'x'.repeat(33), '-ann', '_ann', 'ann smith', 'ann.smith', 'Ann', 'anné'])
      expect(usernameProblem(name), name).toBe('username')
  })

  it('says every reserved name is taken', () => {
    for (const name of RESERVED_SIGNUP_NAMES) expect(usernameProblem(name), name).toBe('taken')
  })
})

describe('parseInviteNote', () => {
  it('is null when there is no note', () => {
    for (const value of [undefined, null, '', '   ', '\u0000\u0007']) expect(parseInviteNote(value)).toBeNull()
  })

  it('trims it and removes control characters', () => {
    expect(parseInviteNote('  for\u0000 Ann\u009b \n')).toBe('for Ann')
  })

  it('takes 60 characters and refuses 61, or anything not a string', () => {
    expect(parseInviteNote('é'.repeat(60))).toBe('é'.repeat(60))
    expect(parseInviteNote('x'.repeat(61))).toBe('invalid')
    expect(parseInviteNote(7)).toBe('invalid')
    expect(parseInviteNote(['note'])).toBe('invalid')
  })
})

describe('the invite bodies', () => {
  it('take a note or none, and nothing else', () => {
    expect(parseNewInvite({})).toEqual({ note: null })
    expect(parseNewInvite({ note: ' for Ann ' })).toEqual({ note: 'for Ann' })
    expect(parseNewInvite({ note: 'x'.repeat(61) })).toBeNull()
    expect(parseNewInvite({ note: 'a', role: 'admin' })).toBeNull()
    expect(parseNewInvite(null)).toBeNull()
    expect(parseNewInvite([])).toBeNull()
  })

  it('revoke only with the revoke intent', () => {
    expect(parseInviteChange({ intent: 'revoke' })).toEqual({ intent: 'revoke' })
    expect(parseInviteChange({ intent: 'delete' })).toBeNull()
    expect(parseInviteChange({ intent: 'revoke', id: 'x' })).toBeNull()
    expect(parseInviteChange('revoke')).toBeNull()
  })
})
