import { afterEach, describe, expect, it, vi } from 'vitest'
import { discardUpload, finishBook, startBook, uploadChapter, uploadPicture } from './import-client'

const ID = '0f8e2a9c-1b3d-4c5e-8f70-123456789abc'
const calls: { url: string; init: RequestInit }[] = []

function answer(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
    }),
  )
}

afterEach(() => {
  calls.length = 0
})

const BOOK = {
  title: 'Figures',
  author: 'Ada',
  language: 'en',
  chapterCount: 2,
  description: null,
  isbn: null,
  publisher: null,
  publishedYear: null,
  images: { count: 3, bytes: 1000 },
}

describe('startBook', () => {
  it('posts the book with its pictures and gives its id and the room left', async () => {
    answer(201, { id: ID, imageBytesLeft: 5000 })
    expect(await startBook(BOOK)).toEqual({ ok: true, value: { id: ID, imageBytesLeft: 5000 } })
    expect(calls[0]?.url).toBe('/account/books/new')
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual(BOOK)
    expect(new Headers(calls[0]?.init.headers).get('content-type')).toBe('application/json')
  })

  it('keeps the limit a quota refusal names, for its message', async () => {
    answer(409, { error: 'quota', scope: 'books', max: 2 })
    expect(await startBook(BOOK)).toEqual({ ok: false, problem: 'quota', max: 2 })
    answer(409, { error: 'quota', scope: 'user', max: 1024 })
    expect(await startBook(BOOK)).toEqual({ ok: false, problem: 'quota-user', max: 1024 })
    answer(409, { error: 'quota', scope: 'books', max: '25' })
    expect(await startBook(BOOK)).toEqual({ ok: false, problem: 'quota' })
  })

  it.each([
    [409, { error: 'quota' }, 'quota'],
    [429, { error: 'rate' }, 'rate'],
    [401, { error: 'signed-out' }, 'signed-out'],
    [400, { error: 'too-long' }, 'too-long'],
    [400, { error: 'teapot' }, 'failed'],
    [502, 'not json', 'failed'],
  ])('answers %i %j as %s', async (status, body, problem) => {
    answer(status, body)
    expect(await startBook(BOOK)).toEqual({ ok: false, problem })
  })

  it('needs an id in the answer', async () => {
    answer(201, {})
    expect(await startBook(BOOK)).toEqual({ ok: false, problem: 'failed' })
  })
})

describe('chapters and finishing', () => {
  it('posts a chapter at its position and finishes the book', async () => {
    answer(200, { ok: true })
    expect(await uploadChapter(ID, 3, '{"title":"T","blocks":[]}')).toEqual({ ok: true, value: true })
    expect(calls[0]?.url).toBe(`/account/books/${ID}/chapters/3`)
    expect(calls[0]?.init.body).toBe('{"title":"T","blocks":[]}')
    expect(await finishBook(ID)).toEqual({ ok: true, value: true })
    expect(calls[1]?.url).toBe(`/account/books/${ID}/finish`)
  })

  it.each([
    [413, { error: 'request-too-large' }, 'request-too-large'],
    [413, { error: 'book-too-large' }, 'book-too-large'],
    [413, { error: 'article-too-large' }, 'article-too-large'],
    [400, { error: 'empty' }, 'empty'],
    [409, { error: 'incomplete' }, 'incomplete'],
    [404, { error: 'not-found' }, 'not-found'],
    [200, {}, 'failed'],
  ])('answers %i %j as %s', async (status, body, problem) => {
    answer(status, body)
    expect(await uploadChapter(ID, 0, '{}')).toEqual({ ok: false, problem })
  })

  it('keeps the article text cap a refused chapter names', async () => {
    answer(413, { error: 'article-too-large', max: 1048576 })
    expect(await uploadChapter(ID, 0, '{}')).toEqual({ ok: false, problem: 'article-too-large', max: 1048576 })
  })
})

describe('uploadPicture', () => {
  it('posts the drawn picture with its type and gives its stored size', async () => {
    answer(200, { ok: true, width: 900, height: 600 })
    const blob = new Blob([new Uint8Array([1])], { type: 'image/png' })
    expect(await uploadPicture(ID, 12, blob)).toEqual({ ok: true, value: { width: 900, height: 600 } })
    expect(calls[0]?.url).toBe(`/account/books/${ID}/images/12`)
    expect(new Headers(calls[0]?.init.headers).get('content-type')).toBe('image/png')
  })

  it('keeps the account’s picture limit a refusal names', async () => {
    answer(409, { error: 'quota', scope: 'user', max: 4096 })
    expect(await uploadPicture(ID, 1, new Blob([], { type: 'image/jpeg' }))).toEqual({
      ok: false,
      problem: 'quota-user',
      max: 4096,
    })
  })

  it.each([
    [409, { error: 'quota', scope: 'book', max: 1 }, 'quota-book'],
    [409, { error: 'quota', scope: 'user' }, 'quota-user'],
    [413, { error: 'request-too-large' }, 'too-large'],
    [415, { error: 'invalid' }, 'type'],
    [400, { error: 'invalid' }, 'invalid'],
    [404, { error: 'not-found' }, 'not-found'],
    [500, { error: 'failed' }, 'failed'],
    [200, { ok: true }, 'failed'],
  ])('answers %i %j as %s', async (status, body, problem) => {
    answer(status, body)
    expect(await uploadPicture(ID, 1, new Blob([], { type: 'image/jpeg' }))).toEqual({ ok: false, problem })
  })
})

describe('network failures and discarding', () => {
  it('answers a network error as failed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    expect(await startBook(BOOK)).toEqual({ ok: false, problem: 'failed' })
    expect(await uploadPicture(ID, 1, new Blob([]))).toEqual({ ok: false, problem: 'failed' })
    expect(await finishBook(ID)).toEqual({ ok: false, problem: 'failed' })
  })

  it('discards a half-saved book with the delete form', async () => {
    answer(303, '')
    discardUpload(ID)
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]?.url).toBe('/account/books')
    expect(String(calls[0]?.init.body)).toBe(`intent=delete&id=${ID}`)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    expect(() => discardUpload(ID)).not.toThrow()
  })
})
