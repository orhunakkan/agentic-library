import { describe, expect, it, vi } from 'vitest'
import {
  fetchArticle,
  fetchArticlePicture,
  readArticleAnswer,
  startArticle,
} from '~/client/features/articles/articles-client'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

function answering(response: Response | Error) {
  const fetchMock = vi.fn(async () => {
    if (response instanceof Error) throw response
    return response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const START = {
  title: 'T',
  author: 'A',
  language: 'en',
  chapterCount: 1,
  description: null,
  isbn: null,
  publisher: null,
  publishedYear: null,
  images: { count: 0, bytes: 0 },
  article: 'f1',
}

describe('the requests', () => {
  it('fetches a page', async () => {
    const fetchMock = answering(json(200, { fetch: 'f1', finalUrl: 'https://a.test/x', html: '<p>' }))
    expect(await fetchArticle('a.test/x')).toEqual({
      ok: true,
      value: { fetch: 'f1', finalUrl: 'https://a.test/x', html: '<p>' },
    })
    expect(fetchMock).toHaveBeenCalledWith('/account/articles/fetch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'a.test/x' }),
    })
  })

  it('fetches a picture’s bytes, or null', async () => {
    answering(new Response(new Uint8Array([1, 2])))
    expect(await fetchArticlePicture('f1', 'https://a.test/p.png')).toEqual(new Uint8Array([1, 2]))
    answering(json(404, { error: 'not_found' }))
    expect(await fetchArticlePicture('f1', 'https://a.test/p.png')).toBeNull()
    answering(new TypeError('offline'))
    expect(await fetchArticlePicture('f1', 'https://a.test/p.png')).toBeNull()
  })

  it('starts an article', async () => {
    const fetchMock = answering(json(201, { id: 'b1', imageBytesLeft: 9 }))
    expect(await startArticle(START)).toEqual({ ok: true, value: { id: 'b1', imageBytesLeft: 9 } })
    expect(fetchMock).toHaveBeenCalledWith('/account/books/new', expect.objectContaining({ method: 'POST' }))
    answering(json(201, { id: 'b1' }))
    expect(await startArticle(START)).toEqual({ ok: true, value: { id: 'b1', imageBytesLeft: 0 } })
  })

  it('a network failure is failed', async () => {
    answering(new TypeError('offline'))
    expect(await fetchArticle('a.test')).toMatchObject({ ok: false, problem: 'failed' })
  })
})

describe('readArticleAnswer', () => {
  const read = (status: number, body: unknown) => readArticleAnswer(json(status, body), () => true)
  it('names each problem', async () => {
    expect(await read(400, { error: 'invalid', reason: 'private_host' })).toMatchObject({ problem: 'private_host' })
    expect(await read(400, { error: 'invalid', reason: 'odd' })).toMatchObject({ problem: 'failed' })
    expect(await read(400, { error: 'invalid' })).toMatchObject({ problem: 'failed' })
    for (const code of [
      'blocked',
      'page_not_found',
      'refused',
      'not_html',
      'too_large',
      'too_many_redirects',
      'unavailable',
      'expired',
      'busy',
      'signed_out',
    ])
      expect(await read(422, { error: code }), code).toMatchObject({ problem: code })
    expect(await read(401, { error: 'signed-out' })).toMatchObject({ problem: 'signed_out' })
    expect(await read(500, { error: 'what' })).toMatchObject({ problem: 'failed' })
    expect(await readArticleAnswer(new Response('nope', { status: 502 }), () => true)).toMatchObject({
      problem: 'failed',
    })
  })
  it('carries what each problem needs', async () => {
    expect(await read(409, { error: 'exists', id: 'b1' })).toEqual({
      ok: false,
      problem: 'exists',
      failure: { problem: 'exists', existingId: 'b1' },
    })
    expect(await read(409, { error: 'exists' })).toMatchObject({ failure: { problem: 'exists' } })
    expect(await read(429, { error: 'limited', retryAt: '2026-11-21T14:05:00Z' })).toMatchObject({
      failure: { retryAt: '2026-11-21T14:05:00Z' },
    })
    expect(await read(429, { error: 'limited' })).toMatchObject({ failure: { retryAt: null } })
    expect(await read(409, { error: 'quota', scope: 'articles', max: 500 })).toMatchObject({
      failure: { problem: 'quota', max: 500 },
    })
    expect(await read(409, { error: 'quota', scope: 'articles' })).toMatchObject({
      failure: { problem: 'quota', max: undefined },
    })
    expect(await read(409, { error: 'quota', scope: 'user' })).toMatchObject({ problem: 'failed' })
  })
  it('is failed when a success answer isn’t what was asked for', async () => {
    expect(await readArticleAnswer(json(200, {}), () => undefined)).toMatchObject({ problem: 'failed' })
  })
})
