import { afterEach, describe, expect, it, vi } from 'vitest'
import { deleteCard, reviewCard, saveCard } from './flashcards-client'

const CARD = {
  id: '6f1c0000-0000-4000-8000-000000000001',
  front: 'Who?',
  back: 'Him.',
  source: null,
  box: 0,
  dueAt: '2026-11-09T10:00:00Z',
  createdAt: '2026-11-09T10:00:00Z',
}
const request = {
  book: 'pride-and-prejudice',
  front: 'Who?',
  back: 'Him.',
  position: { chapter: 'chapter-3', page: 2 },
  origin: 'flashcards' as const,
}

function answer(status: number, body: unknown) {
  const fetch = vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

afterEach(() => vi.unstubAllGlobals())

describe('saveCard', () => {
  it('posts the card and says whether the book had it already', async () => {
    const fetch = answer(201, { card: CARD, existed: false })
    expect(await saveCard(request)).toEqual({ ok: true, value: { card: CARD, existed: false } })
    expect(fetch).toHaveBeenCalledWith('/account/flashcards/new', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    })
    answer(200, { card: CARD, existed: true })
    expect(await saveCard(request)).toEqual({ ok: true, value: { card: CARD, existed: true } })
  })

  it('maps each refusal and a network failure to its problem', async () => {
    answer(409, { error: 'quota', scope: 'book', max: 1000 })
    expect(await saveCard(request)).toEqual({ ok: false, problem: 'quota-book' })
    answer(409, { error: 'quota', scope: 'user', max: 10000 })
    expect(await saveCard(request)).toEqual({ ok: false, problem: 'quota-user' })
    answer(401, { error: 'signed_out' })
    expect(await saveCard(request)).toEqual({ ok: false, problem: 'signed_out' })
    answer(404, { error: 'not_found' })
    expect(await saveCard(request)).toEqual({ ok: false, problem: 'not_found' })
    answer(409, { error: 'stale' })
    expect(await saveCard(request)).toEqual({ ok: false, problem: 'failed' })
    answer(200, { nothing: true })
    expect(await saveCard(request)).toEqual({ ok: false, problem: 'failed' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('offline'))),
    )
    expect(await saveCard(request)).toEqual({ ok: false, problem: 'failed' })
  })
})

describe('reviewCard and deleteCard', () => {
  it('posts a review and reads back the card', async () => {
    const fetch = answer(200, { card: { ...CARD, box: 1 } })
    expect(await reviewCard(CARD.id, 'good')).toEqual({ ok: true, value: { ...CARD, box: 1 } })
    expect(fetch).toHaveBeenCalledWith(
      `/account/flashcards/${CARD.id}`,
      expect.objectContaining({ body: '{"review":"good"}' }),
    )
    answer(404, { error: 'not_found' })
    expect(await reviewCard(CARD.id, 'again')).toEqual({ ok: false, problem: 'not_found' })
  })

  it('posts a delete', async () => {
    const fetch = answer(200, { deleted: true })
    expect(await deleteCard(CARD.id)).toEqual({ ok: true, value: true })
    expect(fetch).toHaveBeenCalledWith(
      `/account/flashcards/${CARD.id}`,
      expect.objectContaining({ body: '{"delete":true}' }),
    )
    answer(500, { error: 'failed' })
    expect(await deleteCard(CARD.id)).toEqual({ ok: false, problem: 'failed' })
  })
})
