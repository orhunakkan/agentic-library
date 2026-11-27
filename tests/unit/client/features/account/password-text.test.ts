import { describe, expect, it } from 'vitest'
import { MISMATCH_TEXT, newPasswordText, parseReason } from '~/client/features/account/password-text'

describe('newPasswordText', () => {
  it('says what is wrong with the new password', () => {
    expect(newPasswordText('mismatch', undefined)).toBe(MISMATCH_TEXT)
    expect(newPasswordText('mismatch', 'short')).toBe('The new passwords don’t match.')
    expect(newPasswordText('policy', 'short')).toBe('Use at least 15 characters.')
    expect(newPasswordText('policy', 'long')).toBe('Use at most 256 characters.')
    expect(newPasswordText('policy', 'username')).toBe('Don’t use your username.')
    expect(newPasswordText('policy', undefined)).toBe('Choose a different password.')
  })
})

describe('parseReason', () => {
  it('takes only the known codes', () => {
    expect(parseReason('short')).toBe('short')
    expect(parseReason('<b>hi</b>')).toBeUndefined()
    expect(parseReason(undefined)).toBeUndefined()
  })
})
