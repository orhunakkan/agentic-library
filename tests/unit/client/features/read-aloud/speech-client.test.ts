import { describe, expect, it, vi } from 'vitest'
import { decodeBase64, loadCloudVoices, speak } from '~/client/features/read-aloud/speech-client'
import type { SpeakRequest } from '~/shared/read-aloud/cloud'

const REQUEST: SpeakRequest = {
  book: 'pride-and-prejudice',
  chapter: 0,
  voice: 'Aria01',
  position: { chapter: 'chapter-1', page: 1 },
  start: 0,
  end: 57,
}

const answering = (status: number, body: unknown) =>
  vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }))

describe('speak', () => {
  it('posts the request as JSON, with positions only, and decodes the audio to an MP3 Blob', async () => {
    const fetchFn = answering(200, {
      audio: btoa('ID3 audio'),
      words: [{ start: 0, end: 2, t0: 0, t1: 120 }, { start: 3, end: 2, t0: 0, t1: 1 }, { start: 'x' }, null],
      format: 'low',
    })
    const signal = new AbortController().signal
    const result = await speak(REQUEST, signal, fetchFn as unknown as typeof fetch)
    expect(fetchFn).toHaveBeenCalledWith('/account/read-aloud/speak', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(REQUEST),
      signal,
    })
    if (!result.ok) throw new Error('expected audio')
    expect(result.audio.type).toBe('audio/mpeg')
    expect(await result.audio.text()).toBe('ID3 audio')
    expect(result.words).toEqual([{ start: 0, end: 2, t0: 0, t1: 120 }])
    expect(result.format).toBe('low')
  })

  it('turns every refusal code into its problem, and anything else into failed', async () => {
    for (const code of [
      'invalid',
      'not_found',
      'signed_out',
      'no_key',
      'key_rejected',
      'no_credits',
      'permission',
      'voice_gone',
      'busy',
      'failed',
    ]) {
      const result = await speak(REQUEST, undefined, answering(400, { error: code }) as unknown as typeof fetch)
      expect(result, code).toEqual({ ok: false, problem: code, retryAt: undefined })
    }
    const odd = await speak(REQUEST, undefined, answering(500, { error: 'mystery' }) as unknown as typeof fetch)
    expect(odd).toMatchObject({ ok: false, problem: 'failed' })
    const html = await speak(REQUEST, undefined, answering(502, '<html>') as unknown as typeof fetch)
    expect(html).toMatchObject({ ok: false, problem: 'failed' })
  })

  it('carries when to try again for the hourly limit', async () => {
    const at = '2026-11-07T14:05:00.000Z'
    const result = await speak(
      REQUEST,
      undefined,
      answering(429, { error: 'rate', retryAt: at }) as unknown as typeof fetch,
    )
    expect(result).toEqual({ ok: false, problem: 'rate', retryAt: new Date(at) })
    const garbled = await speak(
      REQUEST,
      undefined,
      answering(429, { error: 'rate', retryAt: 'soon' }) as unknown as typeof fetch,
    )
    expect(garbled).toEqual({ ok: false, problem: 'rate', retryAt: undefined })
  })

  it('is failed for a network failure, an answer without audio, and audio that isn’t base64', async () => {
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    expect(await speak(REQUEST, undefined, offline as unknown as typeof fetch)).toMatchObject({ problem: 'failed' })
    for (const body of [
      { words: [], format: 'low' },
      { audio: 'SUQz', format: 'high' },
      { audio: '%%%', format: 'low' },
    ])
      expect(await speak(REQUEST, undefined, answering(200, body) as unknown as typeof fetch)).toMatchObject({
        ok: false,
        problem: 'failed',
      })
    const noWords = await speak(REQUEST, undefined, answering(200, { audio: 'SUQz', format: 'standard' }) as never)
    expect(noWords).toMatchObject({ ok: true, words: [], format: 'standard' })
  })
})

describe('decodeBase64', () => {
  it('gives the bytes', () => {
    expect([...decodeBase64(btoa('\x00\xff\x10'))]).toEqual([0, 255, 16])
  })
})

describe('loadCloudVoices', () => {
  it('passes the state through, and says unavailable when asking fails', async () => {
    const ready = { state: 'ready' as const, voices: [], model: 'eleven_v4_turbo' }
    expect(await loadCloudVoices('pride-and-prejudice', async () => ready)).toBe(ready)
    expect(
      await loadCloudVoices('pride-and-prejudice', async () => {
        throw new Error('offline')
      }),
    ).toEqual({ state: 'unavailable' })
  })
})
