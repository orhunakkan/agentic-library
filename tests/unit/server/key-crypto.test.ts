import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { type Kek, kekId } from '~/server/config'
import { associatedData, open, seal } from '~/server/key-crypto'

const kek = (): Kek => {
  const key = randomBytes(32)
  return { key, id: kekId(key) }
}
const KEY = 'sk-ant-api03-example-key-0123456789'

describe('AES-256-GCM key sealing', () => {
  it('round-trips with the same KEK and associated data', () => {
    const k = kek()
    const sealed = seal(KEY, k, associatedData(7, 'anthropic'))
    expect(sealed.ciphertext.toString('utf8')).not.toContain('sk-ant')
    expect(sealed.iv).toHaveLength(12)
    expect(sealed.authTag).toHaveLength(16)
    expect(sealed.kekId).toBe(k.id)
    expect(open(sealed, k, associatedData(7, 'anthropic'))).toBe(KEY)
  })

  it('uses a fresh IV every time', () => {
    const k = kek()
    const a = seal(KEY, k, associatedData(7, 'anthropic'))
    const b = seal(KEY, k, associatedData(7, 'anthropic'))
    expect(a.iv.equals(b.iv)).toBe(false)
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false)
  })

  it('fails for another user or provider (a ciphertext copied to another row)', () => {
    const k = kek()
    const sealed = seal(KEY, k, associatedData(7, 'anthropic'))
    expect(() => open(sealed, k, associatedData(8, 'anthropic'))).toThrow()
    expect(() => open(sealed, k, associatedData(7, 'openai'))).toThrow()
  })

  it('fails with a tampered tag or ciphertext', () => {
    const k = kek()
    const sealed = seal(KEY, k, associatedData(7, 'anthropic'))
    const tag = Buffer.from(sealed.authTag)
    tag[0] = (tag[0] ?? 0) ^ 1
    expect(() => open({ ...sealed, authTag: tag }, k, associatedData(7, 'anthropic'))).toThrow()
    const body = Buffer.from(sealed.ciphertext)
    body[0] = (body[0] ?? 0) ^ 1
    expect(() => open({ ...sealed, ciphertext: body }, k, associatedData(7, 'anthropic'))).toThrow()
  })

  it('fails with the wrong KEK', () => {
    const sealed = seal(KEY, kek(), associatedData(7, 'anthropic'))
    expect(() => open(sealed, kek(), associatedData(7, 'anthropic'))).toThrow()
  })
})
