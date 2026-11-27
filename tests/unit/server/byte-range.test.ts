import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { parseRange, rangeResponse } from '~/server/byte-range'

describe('parseRange', () => {
  it('reads one range against the size', () => {
    expect(parseRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 })
    expect(parseRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 })
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 })
    expect(parseRange('bytes=95-200', 100)).toEqual({ start: 95, end: 99 })
    expect(parseRange('bytes=100-', 100)).toBeNull()
    expect(parseRange('bytes=5-1', 100)).toBeNull()
    expect(parseRange('bytes=-', 100)).toBeNull()
    expect(parseRange('bytes=0-1,4-5', 100)).toBeNull()
    expect(parseRange('items=0-1', 100)).toBeNull()
  })
})

describe('rangeResponse', () => {
  const dir = mkdtempSync(join(tmpdir(), 'byte-range-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'file.bin')
  writeFileSync(path, 'abcdefghij')
  const empty = join(dir, 'empty.bin')
  writeFileSync(empty, '')
  const get = (headers: Record<string, string> = {}, method = 'GET') =>
    new Request('http://localhost/x', { method, headers })
  const headers = { 'content-type': 'audio/mpeg' }

  it('sends the whole file, with the caller’s headers', async () => {
    const res = rangeResponse(get(), path, 10, headers)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('audio/mpeg')
    expect(res.headers.get('accept-ranges')).toBe('bytes')
    expect(res.headers.get('content-length')).toBe('10')
    expect(await res.text()).toBe('abcdefghij')
  })

  it('sends one range as 206, and answers 416 for one it can’t', async () => {
    const res = rangeResponse(get({ range: 'bytes=2-4' }), path, 10, headers)
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 2-4/10')
    expect(res.headers.get('content-length')).toBe('3')
    expect(await res.text()).toBe('cde')
    const past = rangeResponse(get({ range: 'bytes=10-' }), path, 10, headers)
    expect(past.status).toBe(416)
    expect(past.headers.get('content-range')).toBe('bytes */10')
  })

  it('answers HEAD with the length and no body, whatever the range', async () => {
    const res = rangeResponse(get({ range: 'bytes=0-1' }, 'HEAD'), path, 10, headers)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-length')).toBe('10')
    expect(await res.text()).toBe('')
  })

  it('sends an empty file as empty', async () => {
    const res = rangeResponse(get(), empty, 0, headers)
    expect(res.headers.get('content-length')).toBe('0')
    expect(await res.text()).toBe('')
  })
})
