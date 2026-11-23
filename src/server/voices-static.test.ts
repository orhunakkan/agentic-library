import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FOLIO_VOICES, voiceUrl } from '~/shared/read-aloud/folio-voices'
import { VOICE_CACHE_CONTROL, voiceFile, voiceHeaders, voiceResponse } from './voices-static'

const DIR = '/srv/voices'

describe('voiceFile', () => {
  it('resolves every catalogue file, with its type and size', () => {
    for (const v of FOLIO_VOICES) {
      const onnx = voiceFile(voiceUrl(v.files.onnx, v.id), DIR)
      expect(onnx).toEqual({
        path: join(DIR, voiceUrl(v.files.onnx, v.id).slice('/voices/'.length)),
        type: 'application/octet-stream',
        bytes: v.files.onnx.bytes,
      })
      expect(voiceFile(voiceUrl(v.files.config, v.id), DIR)?.type).toBe('application/json')
      expect(voiceFile(voiceUrl(v.files.card, v.id), DIR)?.type).toBe('text/markdown; charset=utf-8')
    }
  })

  it('refuses anything that isn’t one of them', () => {
    const cori = FOLIO_VOICES[0]
    if (!cori) throw new Error('the catalogue has voices')
    const good = voiceUrl(cori.files.onnx, cori.id)
    for (const path of [
      good.replace(/\.[0-9a-f]{12}\./, '.000000000000.'),
      '/voices/xx_XX-nobody-medium.2e0a55e140de.onnx',
      `/voices/../${good.slice('/voices/'.length)}`,
      '/voices/..%2Fsecrets',
      `/voices/en%2F${good.slice('/voices/'.length)}`,
      '/voices/',
      '/voices',
      good.replace('/voices/', '/assets/'),
      `${good}x`,
    ])
      expect(voiceFile(path, DIR)).toBeNull()
  })
})

describe('voiceHeaders', () => {
  it('caches for a year and refuses sniffing', () => {
    expect(voiceHeaders({ path: '/x', type: 'application/json', bytes: 1 })).toEqual({
      'content-type': 'application/json',
      'cache-control': VOICE_CACHE_CONTROL,
      'x-content-type-options': 'nosniff',
    })
  })
})

describe('voiceResponse', () => {
  const cori = FOLIO_VOICES[0]
  if (!cori) throw new Error('the catalogue has voices')
  const url = (path: string) => `http://localhost${path}`
  const onnx = voiceUrl(cori.files.onnx, cori.id)
  const card = voiceUrl(cori.files.card, cori.id)
  let dir = ''

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'folio-voices-'))
    writeFileSync(join(dir, onnx.slice('/voices/'.length)), '0123456789')
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('sends the whole file with its headers', async () => {
    const response = await voiceResponse(new Request(url(onnx)), dir)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-length')).toBe('10')
    expect(response.headers.get('content-type')).toBe('application/octet-stream')
    expect(response.headers.get('cache-control')).toBe(VOICE_CACHE_CONTROL)
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await response.text()).toBe('0123456789')
  })

  it('answers HEAD with the length and no body', async () => {
    const response = await voiceResponse(new Request(url(onnx), { method: 'HEAD' }), dir)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-length')).toBe('10')
    expect(await response.text()).toBe('')
  })

  it('sends a range, and refuses one past the end', async () => {
    const part = await voiceResponse(new Request(url(onnx), { headers: { range: 'bytes=2-4' } }), dir)
    expect(part.status).toBe(206)
    expect(part.headers.get('content-range')).toBe('bytes 2-4/10')
    expect(await part.text()).toBe('234')
    const past = await voiceResponse(new Request(url(onnx), { headers: { range: 'bytes=20-' } }), dir)
    expect(past.status).toBe(416)
    expect(past.headers.get('content-range')).toBe('bytes */10')
  })

  it('is a 404 for a missing file, another path or another method', async () => {
    expect((await voiceResponse(new Request(url(card)), dir)).status).toBe(404)
    expect((await voiceResponse(new Request(url('/voices/../package.json')), dir)).status).toBe(404)
    expect((await voiceResponse(new Request(url('/voices/')), dir)).status).toBe(404)
    expect((await voiceResponse(new Request(url(onnx), { method: 'POST' }), dir)).status).toBe(404)
  })
})
