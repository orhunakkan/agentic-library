import { describe, expect, it, vi } from 'vitest'
import { readRatingAnswer, setRating } from '~/client/features/ratings/ratings-client'

function answer(status: number, body: unknown) {
  const fetch = vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

describe('setRating', () => {
  it('posts the book and its stars, and answers the rating afterwards', async () => {
    const fetch = answer(200, { book: 'the-prophet', stars: 4 })
    expect(await setRating('the-prophet', 4)).toEqual({ ok: true, value: 4 })
    const [path, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect([path, init.method, JSON.parse(String(init.body))]).toEqual([
      '/account/ratings',
      'POST',
      { book: 'the-prophet', stars: 4 },
    ])
  })

  it('posts null to clear, and answers an unrated book', async () => {
    const fetch = answer(200, { book: 'the-prophet', stars: null })
    expect(await setRating('the-prophet', null)).toEqual({ ok: true, value: null })
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ book: 'the-prophet', stars: null })
  })

  it('is offline when the request never reaches the server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    expect(await setRating('the-prophet', 3)).toEqual({ ok: false, problem: 'offline' })
  })
})

describe('readRatingAnswer', () => {
  const read = (status: number, body: unknown) =>
    readRatingAnswer(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }))

  it('names the problems it knows, and fails for anything else', async () => {
    expect(await read(401, { error: 'signed_out' })).toEqual({ ok: false, problem: 'signed_out' })
    expect(await read(404, { error: 'not_found' })).toEqual({ ok: false, problem: 'not_found' })
    expect(await read(400, { error: 'invalid' })).toEqual({ ok: false, problem: 'failed' })
    expect(await read(413, { error: 'invalid' })).toEqual({ ok: false, problem: 'failed' })
    expect(await read(500, { error: 'failed' })).toEqual({ ok: false, problem: 'failed' })
    expect(await read(403, 'Forbidden')).toEqual({ ok: false, problem: 'failed' })
  })

  it('fails on a success that carries no rating, or a malformed one', async () => {
    expect(await read(200, {})).toEqual({ ok: false, problem: 'failed' })
    expect(await read(200, { stars: 7 })).toEqual({ ok: false, problem: 'failed' })
    expect(await read(200, { stars: '4' })).toEqual({ ok: false, problem: 'failed' })
    expect(await read(200, 'not json')).toEqual({ ok: false, problem: 'failed' })
  })
})
