import { createHmac, timingSafeEqual } from 'node:crypto'

export type SignatureCheck = 'ok' | 'bad-signature' | 'stale' | 'malformed'

const TOLERANCE_SECONDS = 5 * 60

export interface SignedPost {
  id: string | null
  timestamp: string | null
  signature: string | null
  body: string
  key: Buffer
  now: Date
}

export function svixSignature(key: Buffer, id: string, timestamp: string, body: string): string {
  return createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')
}

export function verifySvixSignature({ id, timestamp, signature, body, key, now }: SignedPost): SignatureCheck {
  if (!id || id.length > 100 || !timestamp || !/^\d{1,12}$/.test(timestamp) || !signature) return 'malformed'
  if (Math.abs(now.getTime() / 1000 - Number(timestamp)) > TOLERANCE_SECONDS) return 'stale'
  const expected = Buffer.from(svixSignature(key, id, timestamp, body))
  const matches = signature.split(' ').some((entry) => {
    const comma = entry.indexOf(',')
    if (comma < 0 || entry.slice(0, comma) !== 'v1') return false
    const given = Buffer.from(entry.slice(comma + 1))
    return given.length === expected.length && timingSafeEqual(given, expected)
  })
  return matches ? 'ok' : 'bad-signature'
}
