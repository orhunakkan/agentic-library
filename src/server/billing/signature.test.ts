import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { paddleSignature, paddleSignatureHeader, verifyPaddleSignature } from './signature'

const SECRET = 'pdl_ntfset_01testsecret_abcdefghijklmnop'
const BODY = '{"event_id":"evt_01abc","event_type":"subscription.created","data":{"id":"sub_01abc"}}'
const NOW = new Date('2026-11-10T12:00:00Z')
const TS = String(NOW.getTime() / 1000)

describe('paddleSignature', () => {
  it('is the hex HMAC-SHA256 of ts:body with the secret as it is', () => {
    const expected = createHmac('sha256', SECRET).update(`${TS}:${BODY}`).digest('hex')
    expect(paddleSignature(SECRET, TS, BODY)).toBe(expected)
    expect(expected).toMatch(/^[0-9a-f]{64}$/)
    expect(paddleSignatureHeader(SECRET, BODY, NOW)).toBe(`ts=${TS};h1=${expected}`)
  })
})

describe('verifyPaddleSignature', () => {
  const header = `ts=${TS};h1=${paddleSignature(SECRET, TS, BODY)}`

  it('passes a valid header', () => {
    expect(verifyPaddleSignature(header, BODY, SECRET, NOW)).toEqual({ result: 'ok' })
    expect(
      verifyPaddleSignature(` ts = ${TS} ; h1 = ${paddleSignature(SECRET, TS, BODY)} `, BODY, SECRET, NOW),
    ).toEqual({ result: 'ok' })
  })

  it('passes when one of two h1s is valid, as while a secret rotates', () => {
    const other = paddleSignature('pdl_ntfset_theoldsecret', TS, BODY)
    expect(
      verifyPaddleSignature(`ts=${TS};h1=${other};h1=${paddleSignature(SECRET, TS, BODY)}`, BODY, SECRET, NOW),
    ).toEqual({ result: 'ok' })
    expect(verifyPaddleSignature(`ts=${TS};h1=${other}`, BODY, SECRET, NOW)).toEqual({ result: 'bad-signature' })
  })

  it('refuses a wrong secret and a changed body byte', () => {
    expect(verifyPaddleSignature(header, BODY, 'pdl_ntfset_anothersecret', NOW)).toEqual({ result: 'bad-signature' })
    expect(verifyPaddleSignature(header, BODY.replace('sub_01abc', 'sub_01abd'), SECRET, NOW)).toEqual({
      result: 'bad-signature',
    })
    expect(verifyPaddleSignature(`ts=${TS};h1=abc`, BODY, SECRET, NOW)).toEqual({ result: 'bad-signature' })
  })

  it('refuses a timestamp 6 s old or 6 s ahead, and says by how much', () => {
    for (const off of [-6, 6]) {
      const ts = String(Number(TS) - off)
      const signed = `ts=${ts};h1=${paddleSignature(SECRET, ts, BODY)}`
      expect(verifyPaddleSignature(signed, BODY, SECRET, NOW)).toEqual({ result: 'stale', offBySeconds: off })
    }
    const ts = String(Number(TS) - 5)
    expect(verifyPaddleSignature(`ts=${ts};h1=${paddleSignature(SECRET, ts, BODY)}`, BODY, SECRET, NOW)).toEqual({
      result: 'ok',
    })
  })

  it('refuses a malformed header', () => {
    for (const bad of [
      null,
      '',
      'h1=abc',
      `ts=${TS}`,
      `ts=soon;h1=abc`,
      `ts=${TS};h1`,
      `t=${TS},v1=abc`,
      `ts=${TS};h1=${'a'.repeat(1000)}`,
    ])
      expect(verifyPaddleSignature(bad, BODY, SECRET, NOW), String(bad)).toEqual({ result: 'malformed' })
  })
})
