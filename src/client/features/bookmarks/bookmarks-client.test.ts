import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBookmark, deleteBookmark } from './bookmarks-client'

const BOOKMARK = { id: 'b1', status: 'ok', opening: 'It is a truth', place: null, createdAt: '2026-11-05T10:00:00Z' }
const request = { book: 'pride-and-prejudice', position: { chapter: 'chapter-6', page: 2 } }

function answer(status: number, body: unknown) {
  const fetch = vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

afterEach(() => vi.unstubAllGlobals())

describe('createBookmark', () => {
  it('posts only the book and the position', async () => {
    const fetch = answer(201, { bookmark: BOOKMARK })
    await createBookmark(request)
    expect(fetch).toHaveBeenCalledWith('/account/bookmarks/new', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    })
  })

  it('says created for a 201, and not for a 200', async () => {
    answer(201, { bookmark: BOOKMARK })
    expect(await createBookmark(request)).toEqual({ ok: true, value: { bookmark: BOOKMARK, created: true } })
    answer(200, { bookmark: BOOKMARK })
    expect(await createBookmark(request)).toEqual({ ok: true, value: { bookmark: BOOKMARK, created: false } })
  })

  it('maps each refusal to its problem', async () => {
    answer(409, { error: 'quota', scope: 'book', max: 1000 })
    expect(await createBookmark(request)).toEqual({ ok: false, problem: 'quota-book' })
    answer(409, { error: 'quota', scope: 'user', max: 10000 })
    expect(await createBookmark(request)).toEqual({ ok: false, problem: 'quota-user' })
    answer(401, { error: 'signed_out' })
    expect(await createBookmark(request)).toEqual({ ok: false, problem: 'signed_out' })
    answer(404, { error: 'not_found' })
    expect(await createBookmark(request)).toEqual({ ok: false, problem: 'not_found' })
  })

  it('treats stale, other codes, a body without a bookmark and a network error as failures', async () => {
    answer(409, { error: 'stale' })
    expect(await createBookmark(request)).toEqual({ ok: false, problem: 'failed' })
    answer(403, { error: 'pro' })
    expect(await createBookmark(request)).toEqual({ ok: false, problem: 'failed' })
    answer(409, { error: 'quota', plan: 'free', max: 50 })
    expect(await createBookmark(request)).toEqual({ ok: false, problem: 'failed' })
    answer(400, { error: 'invalid' })
    expect(await createBookmark(request)).toEqual({ ok: false, problem: 'failed' })
    answer(403, 'Forbidden')
    expect(await createBookmark(request)).toEqual({ ok: false, problem: 'failed' })
    answer(201, {})
    expect(await createBookmark(request)).toEqual({ ok: false, problem: 'failed' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    expect(await createBookmark(request)).toEqual({ ok: false, problem: 'failed' })
  })
})

describe('deleteBookmark', () => {
  it('posts the delete intent and reads { ok: true }', async () => {
    const fetch = answer(200, { ok: true })
    expect(await deleteBookmark('6f1c0000-0000-4000-8000-000000000000')).toEqual({ ok: true, value: true })
    expect(fetch).toHaveBeenCalledWith('/account/bookmarks/6f1c0000-0000-4000-8000-000000000000', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ intent: 'delete' }),
    })
    answer(404, { error: 'not_found' })
    expect(await deleteBookmark('gone')).toEqual({ ok: false, problem: 'not_found' })
    answer(200, {})
    expect(await deleteBookmark('odd')).toEqual({ ok: false, problem: 'failed' })
  })
})
