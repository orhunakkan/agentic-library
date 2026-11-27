import { describe, expect, it, vi } from 'vitest'
import {
  type AudioBookmarkRequest,
  createAudioBookmark,
  deleteAudioBookmark,
} from '~/client/features/bookmarks/audio-bookmarks-client'

const BOOKMARK = {
  kind: 'episode',
  id: 'b1',
  status: 'ok',
  positionMs: 15_000,
  episode: { id: 'ep_1', number: 1, title: 'The Coming of the Ship', durationMs: 484_000 },
  createdAt: '2026-11-05T10:00:00Z',
}
const voice: AudioBookmarkRequest = {
  book: 'pride-and-prejudice',
  kind: 'voice',
  position: { chapter: 'chapter-6', page: 2 },
  offset: 120,
}
const episode: AudioBookmarkRequest = { book: 'the-prophet', kind: 'episode', episode: 'ep_1', positionMs: 15_000 }

function answer(status: number, body: unknown) {
  const fetch = vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

describe('createAudioBookmark', () => {
  it('posts only the place: the page and offset, or the episode and time', async () => {
    const fetch = answer(201, { bookmark: BOOKMARK })
    await createAudioBookmark(voice)
    await createAudioBookmark(episode)
    expect(fetch).toHaveBeenNthCalledWith(1, '/account/bookmarks/audio/new', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(voice),
    })
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/account/bookmarks/audio/new',
      expect.objectContaining({
        body: JSON.stringify(episode),
      }),
    )
  })

  it('says created for a 201, and not for a 200', async () => {
    answer(201, { bookmark: BOOKMARK })
    expect(await createAudioBookmark(episode)).toEqual({ ok: true, value: { bookmark: BOOKMARK, created: true } })
    answer(200, { bookmark: BOOKMARK })
    expect(await createAudioBookmark(episode)).toEqual({ ok: true, value: { bookmark: BOOKMARK, created: false } })
  })

  it('maps each refusal to its problem, and anything else to failed', async () => {
    answer(409, { error: 'quota', scope: 'book', max: 1000 })
    expect(await createAudioBookmark(voice)).toEqual({ ok: false, problem: 'quota-book' })
    answer(409, { error: 'quota', scope: 'user', max: 10000 })
    expect(await createAudioBookmark(voice)).toEqual({ ok: false, problem: 'quota-user' })
    answer(401, { error: 'signed_out' })
    expect(await createAudioBookmark(voice)).toEqual({ ok: false, problem: 'signed_out' })
    answer(404, { error: 'not_found' })
    expect(await createAudioBookmark(voice)).toEqual({ ok: false, problem: 'not_found' })
    answer(400, { error: 'invalid' })
    expect(await createAudioBookmark(voice)).toEqual({ ok: false, problem: 'failed' })
    answer(201, { nothing: true })
    expect(await createAudioBookmark(voice)).toEqual({ ok: false, problem: 'failed' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline')
      }),
    )
    expect(await createAudioBookmark(voice)).toEqual({ ok: false, problem: 'failed' })
  })
})

describe('deleteAudioBookmark', () => {
  it('posts the delete to the bookmark’s address, and reads ok or not_found', async () => {
    const fetch = answer(200, { ok: true })
    expect(await deleteAudioBookmark('a b')).toEqual({ ok: true, value: true })
    expect(fetch).toHaveBeenCalledWith(
      '/account/bookmarks/audio/a%20b',
      expect.objectContaining({
        body: JSON.stringify({ intent: 'delete' }),
      }),
    )
    answer(404, { error: 'not_found' })
    expect(await deleteAudioBookmark('b1')).toEqual({ ok: false, problem: 'not_found' })
  })
})
