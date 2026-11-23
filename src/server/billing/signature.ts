import { createHmac, timingSafeEqual } from 'node:crypto'

export const TOLERANCE_SECONDS = 5

export type PaddleSignatureCheck =
  | { result: 'ok' }
  | { result: 'malformed' }
  | { result: 'stale'; offBySeconds: number }
  | { result: 'bad-signature' }

export function paddleSignature(secret: string, ts: string, body: string): string {
  return createHmac('sha256', secret).update(`${ts}:${body}`).digest('hex')
}

export function paddleSignatureHeader(secret: string, body: string, now = new Date()): string {
  const ts = String(Math.floor(now.getTime() / 1000))
  return `ts=${ts};h1=${paddleSignature(secret, ts, body)}`
}

export function verifyPaddleSignature(
  header: string | null,
  body: string,
  secret: string,
  now: Date,
): PaddleSignatureCheck {
  if (!header || header.length > 1000) return { result: 'malformed' }
  let ts: string | null = null
  const given: string[] = []
  for (const part of header.split(';')) {
    const equals = part.indexOf('=')
    if (equals < 0) return { result: 'malformed' }
    const key = part.slice(0, equals).trim()
    const value = part.slice(equals + 1).trim()
    if (key === 'ts') ts = value
    else if (key === 'h1') given.push(value)
  }
  if (!ts || !/^\d{1,12}$/.test(ts) || given.length === 0) return { result: 'malformed' }
  const off = Math.round(now.getTime() / 1000 - Number(ts))
  if (Math.abs(off) > TOLERANCE_SECONDS) return { result: 'stale', offBySeconds: off }
  const expected = Buffer.from(paddleSignature(secret, ts, body))
  const matches = given.some((h1) => {
    const candidate = Buffer.from(h1)
    return candidate.length === expected.length && timingSafeEqual(candidate, expected)
  })
  return matches ? { result: 'ok' } : { result: 'bad-signature' }
}
