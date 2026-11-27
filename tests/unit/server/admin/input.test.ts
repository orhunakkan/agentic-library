import { describe, expect, it } from 'vitest'
import { parseNewUser, parseUserChange } from '~/server/admin/input'

describe('parseNewUser', () => {
  it('takes a username and a role, member by default', () => {
    expect(parseNewUser({ username: 'ada', role: 'admin' })).toEqual({ username: 'ada', role: 'admin' })
    expect(parseNewUser({ username: 'ada-lovelace_1' })).toEqual({ username: 'ada-lovelace_1', role: 'member' })
  })

  it('trims and lowercases the username', () => {
    expect(parseNewUser({ username: '  ADA ', role: 'member' })).toEqual({ username: 'ada', role: 'member' })
  })

  it('refuses usernames that are too short, too long or have other characters', () => {
    for (const username of ['ab', 'a'.repeat(33), '-ada', 'ada lovelace', 'adä', 'ada!', '', 'x'.repeat(65), 42, null])
      expect([username, parseNewUser({ username })]).toEqual([username, null])
    expect(parseNewUser({ username: 'a'.repeat(32) })).not.toBeNull()
    expect(parseNewUser({ username: 'NEW' })).toBeNull()
    expect(parseNewUser({ username: 'newt' })).toEqual({ username: 'newt', role: 'member' })
  })

  it('refuses an unknown role, extra fields and non-objects', () => {
    expect(parseNewUser({ username: 'ada', role: 'root' })).toBeNull()
    expect(parseNewUser({ username: 'ada', role: null })).toBeNull()
    expect(parseNewUser({ username: 'ada', password: 'chosen by the admin' })).toBeNull()
    for (const value of [null, 'ada', ['ada'], 3]) expect(parseNewUser(value)).toBeNull()
  })
})

describe('parseUserChange', () => {
  it('takes every intent', () => {
    for (const intent of ['reset-password', 'disable', 'enable', 'unlock', 'sign-out', 'delete'])
      expect(parseUserChange({ intent })).toEqual({ intent })
    for (const intent of ['grant-pro', 'revoke-pro']) expect(parseUserChange({ intent })).toBeNull()
    expect(parseUserChange({ intent: 'role', role: 'admin' })).toEqual({ intent: 'role', role: 'admin' })
    expect(parseUserChange({ intent: 'role', role: 'member' })).toEqual({ intent: 'role', role: 'member' })
  })

  it('refuses a role change without a known role, and a role with another intent', () => {
    expect(parseUserChange({ intent: 'role' })).toBeNull()
    expect(parseUserChange({ intent: 'role', role: 'owner' })).toBeNull()
    expect(parseUserChange({ intent: 'disable', role: 'admin' })).toBeNull()
  })

  it('refuses unknown intents, extra fields and non-objects', () => {
    expect(parseUserChange({ intent: 'promote' })).toBeNull()
    expect(parseUserChange({})).toBeNull()
    expect(parseUserChange({ intent: 'delete', confirm: 'ada' })).toBeNull()
    for (const value of [null, 'delete', ['delete'], 1]) expect(parseUserChange(value)).toBeNull()
  })
})
