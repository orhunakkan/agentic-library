import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyMatch, lookup, uploadCover } from '~/client/features/book-details/details-client'

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

const query = { book: ID, title: 'Pride', author: 'Austen', isbn: '' }

describe('uploadCover', () => {
  it('posts the drawn image with its type and source, and gives the cover', async () => {
    const cover = { src: `/account/books/${ID}/cover?v=abcdef12`, width: 400, height: 600, source: 'epub' }
    answer(200, { cover })
    const blob = new Blob([new Uint8Array([1])], { type: 'image/jpeg' })
    expect(await uploadCover(ID, blob, 'epub')).toEqual({ ok: true, value: cover })
    expect(calls[0]?.url).toBe(`/account/books/${ID}/cover?source=epub`)
    expect(new Headers(calls[0]?.init.headers).get('content-type')).toBe('image/jpeg')
  })

  it.each([
    [400, { error: 'image', problem: 'small' }, 'small'],
    [400, { error: 'image', problem: 'type' }, 'unreadable'],
    [413, { error: 'image', problem: 'large' }, 'unreadable'],
    [404, { error: 'not_found' }, 'not_found'],
    [500, { error: 'unavailable' }, 'unavailable'],
    [502, 'not json', 'unavailable'],
  ])('answers %i %j as %s', async (status, body, problem) => {
    answer(status, body)
    expect(await uploadCover(ID, new Blob([]), 'upload')).toEqual({ ok: false, problem })
    expect(new Headers(calls[0]?.init.headers).get('content-type')).toBe('image/jpeg')
  })
})

describe('lookup', () => {
  it('gives the matches', async () => {
    const matches = [{ work: 'OL1W', title: 'A', author: null, year: null, coverId: null, thumb: null }]
    answer(200, { matches })
    expect(await lookup(query)).toEqual({ ok: true, value: matches })
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual(query)
  })

  it.each([
    [429, 'rate'],
    [503, 'busy'],
    [502, 'unavailable'],
    [404, 'not_found'],
    [401, 'signed_out'],
    [400, 'invalid'],
    [418, 'teapot'],
  ])('answers a %i with its code', async (status, error) => {
    answer(status, { error, retryAt: '2026-11-05T12:00:00Z' })
    expect(await lookup(query)).toEqual({ ok: false, problem: error === 'teapot' ? 'unavailable' : error })
  })

  it('answers a network error as unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    expect(await lookup(query)).toEqual({ ok: false, problem: 'unavailable' })
    expect(await uploadCover(ID, new Blob([]), 'upload')).toEqual({ ok: false, problem: 'unavailable' })
    expect(await applyMatch(ID, { work: 'OL1W', coverId: null, useCover: true, useDescription: true })).toEqual({
      ok: false,
      problem: 'unavailable',
    })
  })
})

describe('applyMatch', () => {
  const body = { work: 'OL66554W', coverId: 1, useCover: true, useDescription: false }

  it('posts the ids and choices, and gives what changed', async () => {
    const applied = { changed: { description: false, cover: true, isbn: false, year: false }, cover: null }
    answer(200, applied)
    expect(await applyMatch(ID, body)).toEqual({ ok: true, value: applied })
    expect(calls[0]?.url).toBe(`/account/books/${ID}/open-library`)
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual(body)
  })

  it('answers problems by code', async () => {
    answer(429, { error: 'rate' })
    expect(await applyMatch(ID, body)).toEqual({ ok: false, problem: 'rate' })
  })
})
