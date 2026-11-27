import { describe, expect, it, vi } from 'vitest'
import {
  finishAudiobook,
  problemOf,
  sendChunk,
  startAudiobook,
} from '~/client/features/audiobook-import/audiobook-client'

const reply = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))

const START = {
  title: 'T',
  author: 'A',
  narrator: null,
  language: 'en',
  details: { description: null, isbn: null, publisher: null, publishedYear: null },
  files: [{ type: 'mp4' as const, bytes: 10 }],
  chapters: [{ title: 'One', fileN: 1, startMs: 0, durationMs: 1000 }],
  cover: false,
}

describe('startAudiobook', () => {
  it('posts the start and answers the id', async () => {
    const fetch = reply(201, { id: 'abc' })
    vi.stubGlobal('fetch', fetch)
    expect(await startAudiobook(START)).toEqual({ ok: true, value: { id: 'abc' } })
    expect(fetch).toHaveBeenCalledWith('/account/books/new-audiobook', expect.objectContaining({ method: 'POST' }))
  })

  it('names each refusal, and a network failure', async () => {
    vi.stubGlobal('fetch', reply(409, { error: 'quota', scope: 'audio', max: 1 }))
    expect(await startAudiobook(START)).toEqual({ ok: false, problem: { code: 'room', max: 1 } })
    vi.stubGlobal('fetch', reply(201, {}))
    expect(await startAudiobook(START)).toEqual({ ok: false, problem: { code: 'failed' } })
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('offline'))),
    )
    expect(await startAudiobook(START)).toEqual({ ok: false, problem: { code: 'failed' } })
  })
})

describe('problemOf', () => {
  it('maps every code', () => {
    expect(problemOf(409, { error: 'quota', scope: 'server' })).toEqual({ code: 'server-full' })
    expect(problemOf(409, { error: 'quota', scope: 'audio', max: 1024 })).toEqual({ code: 'room', max: 1024 })
    expect(problemOf(409, { error: 'quota', scope: 'audio' })).toEqual({ code: 'failed' })
    expect(problemOf(409, { error: 'quota', scope: 'rate' })).toEqual({ code: 'rate' })
    expect(problemOf(409, { error: 'quota', scope: 'books', max: 2 })).toEqual({ code: 'books', max: 2 })
    expect(problemOf(409, { error: 'quota', scope: 'books' })).toEqual({ code: 'failed' })
    expect(problemOf(400, { error: 'drm' })).toEqual({ code: 'drm' })
    expect(problemOf(400, { error: 'unreadable', reason: 'x' })).toEqual({ code: 'server-unreadable', reason: 'x' })
    expect(problemOf(400, { error: 'unreadable' })).toEqual({
      code: 'server-unreadable',
      reason: 'it couldn’t be read',
    })
    expect(problemOf(401, { error: 'signed_out' })).toEqual({ code: 'signed-out' })
    expect(problemOf(404, { error: 'not_found' })).toEqual({ code: 'interrupted' })
    expect(problemOf(409, { error: 'incomplete' })).toEqual({ code: 'interrupted' })
    expect(problemOf(400, { error: 'invalid' })).toEqual({ code: 'invalid' })
    expect(problemOf(413, { error: 'invalid' })).toEqual({ code: 'failed' })
  })
})

describe('sendChunk', () => {
  it('sends the bytes at the offset and answers what the server holds', async () => {
    const fetch = reply(200, { received: 4 })
    vi.stubGlobal('fetch', fetch)
    expect(await sendChunk('id', 2, 0, new Blob(['abcd']))).toEqual({ ok: true, received: 4 })
    expect(fetch).toHaveBeenCalledWith(
      '/account/books/id/audio/2?offset=0',
      expect.objectContaining({ headers: { 'content-type': 'application/octet-stream' } }),
    )
  })

  it('says where to carry on, what to retry and what not to', async () => {
    vi.stubGlobal('fetch', reply(409, { error: 'offset', received: 7 }))
    expect(await sendChunk('id', 1, 0, new Blob(['x']))).toEqual({ ok: false, offset: 7 })
    vi.stubGlobal('fetch', reply(503, {}))
    expect(await sendChunk('id', 1, 0, new Blob(['x']))).toEqual({
      ok: false,
      problem: { code: 'stopped' },
      retry: true,
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('offline'))),
    )
    expect(await sendChunk('id', 1, 0, new Blob(['x']))).toMatchObject({ retry: true })
    vi.stubGlobal('fetch', reply(409, { error: 'quota', scope: 'server' }))
    expect(await sendChunk('id', 1, 0, new Blob(['x']))).toEqual({
      ok: false,
      problem: { code: 'server-full' },
      retry: false,
    })
  })

  it('lets a cancel through as an AbortError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new DOMException('stop', 'AbortError'))),
    )
    await expect(sendChunk('id', 1, 0, new Blob(['x']))).rejects.toThrow('stop')
  })
})

describe('finishAudiobook', () => {
  it('answers ok, or the reason the server couldn’t read the audio', async () => {
    vi.stubGlobal('fetch', reply(200, { ok: true }))
    expect(await finishAudiobook('id')).toEqual({ ok: true, value: true })
    vi.stubGlobal('fetch', reply(400, { error: 'drm' }))
    expect(await finishAudiobook('id')).toEqual({ ok: false, problem: { code: 'drm' } })
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('offline'))),
    )
    expect(await finishAudiobook('id')).toEqual({ ok: false, problem: { code: 'failed' } })
  })
})
