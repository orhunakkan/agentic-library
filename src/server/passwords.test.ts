import { describe, expect, it } from 'vitest'
import {
  generatePassword,
  hashPassword,
  needsRehash,
  PARAMS,
  PASSWORD_MAX,
  PASSWORD_MIN,
  passwordProblem,
  verifyPassword,
} from './passwords'

const FAST = { memory: 1024, passes: 1, parallelism: 1 }

describe('passwordProblem (NIST SP 800-63B)', () => {
  it('accepts 15 to 256 characters with no composition rules', () => {
    expect(passwordProblem('a'.repeat(PASSWORD_MIN), 'orhun')).toBeNull()
    expect(passwordProblem('all lowercase words here', 'orhun')).toBeNull()
    expect(passwordProblem('a'.repeat(PASSWORD_MAX), 'orhun')).toBeNull()
  })

  it('rejects passwords that are too short or too long', () => {
    expect(passwordProblem('a'.repeat(PASSWORD_MIN - 1), 'orhun')).toBe('short')
    expect(passwordProblem('a'.repeat(PASSWORD_MAX + 1), 'orhun')).toBe('long')
  })

  it('counts characters, not UTF-16 units', () => {
    expect(passwordProblem('😀'.repeat(15), 'orhun')).toBeNull()
    expect(passwordProblem('😀'.repeat(14), 'orhun')).not.toBeNull()
  })

  it('rejects the username itself', () => {
    expect(passwordProblem('averylongusername', 'averylongusername')).toBe('username')
    expect(passwordProblem('AVERYLONGUSERNAME', 'averylongusername')).toBe('username')
  })
})

describe('hashPassword / verifyPassword', () => {
  it('verifies the right password and rejects others', async () => {
    const hash = await hashPassword('correct horse battery staple', FAST)
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=1024,t=1,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/)
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true)
    expect(await verifyPassword('correct horse battery stapl', hash)).toBe(false)
    expect(await verifyPassword(' correct horse battery staple', hash)).toBe(false)
  })

  it('salts every hash', async () => {
    expect(await hashPassword('same password here', FAST)).not.toBe(await hashPassword('same password here', FAST))
  })

  it('normalises to NFC but does not trim or change case', async () => {
    const hash = await hashPassword('café au lait please', FAST)
    expect(await verifyPassword('café au lait please', hash)).toBe(true)
    expect(await verifyPassword('Café au lait please', hash)).toBe(false)
    expect(await verifyPassword('café au lait please ', hash)).toBe(false)
  })

  it('rejects malformed stored hashes', async () => {
    expect(await verifyPassword('anything at all here', 'not a hash')).toBe(false)
    expect(await verifyPassword('anything at all here', '$scrypt$whatever')).toBe(false)
  })

  it('uses at least the OWASP minimum for Argon2id', () => {
    expect(PARAMS.memory).toBeGreaterThanOrEqual(19 * 1024)
    expect(PARAMS.passes).toBeGreaterThanOrEqual(2)
    expect(PARAMS.parallelism).toBe(1)
  })
})

describe('needsRehash', () => {
  it('asks for a rehash when the stored parameters are weaker than the current ones', async () => {
    const weak = await hashPassword('correct horse battery staple', FAST)
    expect(needsRehash(weak)).toBe(true)
    expect(needsRehash(weak, FAST)).toBe(false)
    expect(needsRehash(weak, { ...FAST, passes: 2 })).toBe(true)
    expect(needsRehash('garbage')).toBe(true)
  })
})

describe('generatePassword', () => {
  it('makes 24 unambiguous characters, different every time', () => {
    const a = generatePassword()
    expect(a).toMatch(/^[A-HJ-NP-Za-km-z2-9]{24}$/)
    expect(generatePassword()).not.toBe(a)
  })
})
