import { describe, expect, it } from 'vitest'
import { svixSignature, verifySvixSignature } from './signature'

const SECRET = 'whsec_plJ3nmyCDGBKInavdOK15jsl'
const key = Buffer.from(SECRET.slice('whsec_'.length), 'base64')
const id = 'msg_loFOjxBNrRLzqYUf'
const timestamp = '1731705121'
const body = '{"event_type":"ping","data":{"success":true}}'
const SIGNATURE = 'v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0='
const now = new Date(Number(timestamp) * 1000)

const post = { id, timestamp, signature: SIGNATURE, body, key, now }

describe('verifySvixSignature', () => {
  it('accepts Svix’s own example', () => {
    expect(verifySvixSignature(post)).toBe('ok')
    expect(`v1,${svixSignature(key, id, timestamp, body)}`).toBe(SIGNATURE)
  })

  it('accepts a matching v1 entry among several, and ignores other versions', () => {
    expect(verifySvixSignature({ ...post, signature: `v1,bm90IGl0 ${SIGNATURE}` })).toBe('ok')
    expect(verifySvixSignature({ ...post, signature: `v2,${SIGNATURE.slice(3)} v1,bm90IGl0` })).toBe('bad-signature')
    expect(verifySvixSignature({ ...post, signature: SIGNATURE.replace('v1,', 'v2,') })).toBe('bad-signature')
    expect(verifySvixSignature({ ...post, signature: SIGNATURE.slice(3) })).toBe('bad-signature')
  })

  it('refuses a body changed by one byte and a wrong key', () => {
    expect(verifySvixSignature({ ...post, body: body.replace('true', 'trUe') })).toBe('bad-signature')
    expect(verifySvixSignature({ ...post, body: `${body} ` })).toBe('bad-signature')
    expect(verifySvixSignature({ ...post, key: Buffer.alloc(key.length, 1) })).toBe('bad-signature')
    expect(verifySvixSignature({ ...post, id: 'msg_other' })).toBe('bad-signature')
  })

  it('refuses a timestamp more than 5 minutes off either way', () => {
    const at = (seconds: number) => new Date((Number(timestamp) + seconds) * 1000)
    expect(verifySvixSignature({ ...post, now: at(300) })).toBe('ok')
    expect(verifySvixSignature({ ...post, now: at(-300) })).toBe('ok')
    expect(verifySvixSignature({ ...post, now: at(301) })).toBe('stale')
    expect(verifySvixSignature({ ...post, now: at(-301) })).toBe('stale')
  })

  it('calls missing or malformed headers malformed', () => {
    expect(verifySvixSignature({ ...post, id: null })).toBe('malformed')
    expect(verifySvixSignature({ ...post, id: 'm'.repeat(101) })).toBe('malformed')
    expect(verifySvixSignature({ ...post, timestamp: null })).toBe('malformed')
    expect(verifySvixSignature({ ...post, timestamp: '1731705121.5' })).toBe('malformed')
    expect(verifySvixSignature({ ...post, timestamp: '-1731705121' })).toBe('malformed')
    expect(verifySvixSignature({ ...post, signature: null })).toBe('malformed')
    expect(verifySvixSignature({ ...post, signature: '' })).toBe('malformed')
  })

  it('answers a signature of the wrong length without throwing', () => {
    expect(verifySvixSignature({ ...post, signature: 'v1,c2hvcnQ=' })).toBe('bad-signature')
    expect(verifySvixSignature({ ...post, signature: `v1,${'A'.repeat(400)}` })).toBe('bad-signature')
  })
})
