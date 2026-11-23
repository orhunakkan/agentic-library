import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import type { Kek } from './config.ts'

export interface Sealed {
  ciphertext: Buffer
  iv: Buffer
  authTag: Buffer
  kekId: number
}

export function associatedData(userId: number | string, provider: string): Buffer {
  return Buffer.from(`api_key:v1:${userId}:${provider}`, 'utf8')
}

export function seal(plaintext: string, kek: Kek, aad: Buffer): Sealed {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', kek.key, iv, { authTagLength: 16 })
  cipher.setAAD(aad)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return { ciphertext, iv, authTag: cipher.getAuthTag(), kekId: kek.id }
}

export function open(sealed: Omit<Sealed, 'kekId'>, kek: Kek, aad: Buffer): string {
  const decipher = createDecipheriv('aes-256-gcm', kek.key, sealed.iv, { authTagLength: 16 })
  decipher.setAAD(aad)
  decipher.setAuthTag(sealed.authTag)
  return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]).toString('utf8')
}
