import { describe, expect, it } from 'vitest'
import { parseEmail, parseResetIdentifier, sameAddress } from '~/server/email/input'

describe('parseEmail', () => {
  it('accepts ordinary addresses, trimmed', () => {
    expect(parseEmail('ann@example.com')).toBe('ann@example.com')
    expect(parseEmail('  ann.smith@mail.example.co.uk \n')).toBe('ann.smith@mail.example.co.uk')
    expect(parseEmail('a@b.co')).toBe('a@b.co')
    expect(parseEmail('bounced+one@resend.dev')).toBe('bounced+one@resend.dev')
    expect(parseEmail('x-y_z@my-host.example')).toBe('x-y_z@my-host.example')
  })

  it('lowercases the domain and keeps the local part as typed', () => {
    expect(parseEmail('Ann.Smith@Example.COM')).toBe('Ann.Smith@example.com')
  })

  it('allows 254 characters and refuses 255', () => {
    const domain = `${'d'.repeat(60)}.${'e'.repeat(60)}.${'f'.repeat(60)}.example`
    const at254 = `${'a'.repeat(254 - domain.length - 1)}@${domain}`
    expect(at254.length).toBe(254)
    expect(parseEmail(at254)).toBe(at254)
    expect(parseEmail(`a${at254}`)).toBeNull()
  })

  it('allows a 64-character local part and refuses 65', () => {
    expect(parseEmail(`${'a'.repeat(64)}@example.com`)).not.toBeNull()
    expect(parseEmail(`${'a'.repeat(65)}@example.com`)).toBeNull()
  })

  it('needs exactly one @ and something either side', () => {
    expect(parseEmail('ann.example.com')).toBeNull()
    expect(parseEmail('ann@@example.com')).toBeNull()
    expect(parseEmail('ann@b@example.com')).toBeNull()
    expect(parseEmail('@example.com')).toBeNull()
    expect(parseEmail('ann@')).toBeNull()
    expect(parseEmail('')).toBeNull()
    expect(parseEmail(undefined)).toBeNull()
    expect(parseEmail(42)).toBeNull()
  })

  it('refuses spaces, control characters and anything outside ASCII', () => {
    expect(parseEmail('ann smith@example.com')).toBeNull()
    expect(parseEmail('ann\t@example.com')).toBeNull()
    expect(parseEmail('ann\u0000@example.com')).toBeNull()
    expect(parseEmail('ann\u007f@example.com')).toBeNull()
    expect(parseEmail('anné@example.com')).toBeNull()
    expect(parseEmail('ann@exämple.com')).toBeNull()
  })

  it('refuses a domain without a dot, and leading, trailing or doubled dots', () => {
    expect(parseEmail('ann@localhost')).toBeNull()
    expect(parseEmail('ann@.example.com')).toBeNull()
    expect(parseEmail('ann@example.com.')).toBeNull()
    expect(parseEmail('ann@example..com')).toBeNull()
    expect(parseEmail('.ann@example.com')).toBeNull()
    expect(parseEmail('ann.@example.com')).toBeNull()
    expect(parseEmail('an..n@example.com')).toBeNull()
  })

  it('refuses labels that start or end with a hyphen, or hold other characters', () => {
    expect(parseEmail('ann@-example.com')).toBeNull()
    expect(parseEmail('ann@example-.com')).toBeNull()
    expect(parseEmail('ann@exa_mple.com')).toBeNull()
    expect(parseEmail(`ann@${'a'.repeat(64)}.com`)).toBeNull()
  })
})

describe('sameAddress', () => {
  it('compares without case', () => {
    expect(sameAddress('Ann@Example.com', 'ann@example.com')).toBe(true)
    expect(sameAddress('ann@example.com', 'anne@example.com')).toBe(false)
  })
})

describe('parseResetIdentifier', () => {
  it('reads a username, lowercased', () => {
    expect(parseResetIdentifier('  Ann ')).toEqual({ by: 'username', username: 'ann' })
    expect(parseResetIdentifier('e2e-reader_1')).toEqual({ by: 'username', username: 'e2e-reader_1' })
  })

  it('reads an address when there is an @', () => {
    expect(parseResetIdentifier('Ann@Example.com')).toEqual({ by: 'email', email: 'Ann@example.com' })
    expect(parseResetIdentifier('ann@nowhere')).toBeNull()
  })

  it('refuses empty, too long and neither', () => {
    expect(parseResetIdentifier('')).toBeNull()
    expect(parseResetIdentifier('   ')).toBeNull()
    expect(parseResetIdentifier(`${'a'.repeat(250)}@example.com`)).toBeNull()
    expect(parseResetIdentifier('ab')).toBeNull()
    expect(parseResetIdentifier('not a name')).toBeNull()
    expect(parseResetIdentifier(null)).toBeNull()
  })
})
