import { afterEach, describe, expect, it, vi } from 'vitest'
import { post, readAnswer } from './post'

const reply = (status: number, body: unknown) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
const pick = (b: Record<string, unknown>) => (b.highlight ? b.highlight : undefined)

afterEach(() => vi.unstubAllGlobals())

describe('post', () => {
  it('sends the body as JSON to the path', async () => {
    const fetch = vi.fn(async () => reply(200, {}))
    vi.stubGlobal('fetch', fetch)
    await post('/account/highlights/new', { a: 1 })
    expect(fetch).toHaveBeenCalledWith('/account/highlights/new', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"a":1}',
    })
  })
})

describe('readAnswer', () => {
  it('gives the value of a successful answer', async () => {
    expect(await readAnswer(reply(201, { highlight: { id: 'a' } }), pick)).toEqual({ ok: true, value: { id: 'a' } })
  })

  it('maps each refusal to its problem', async () => {
    expect(await readAnswer(reply(409, { error: 'quota', scope: 'book', max: 1000 }), pick)).toEqual({
      ok: false,
      problem: 'quota-book',
    })
    expect(await readAnswer(reply(409, { error: 'quota', scope: 'user', max: 10000 }), pick)).toEqual({
      ok: false,
      problem: 'quota-user',
    })
    expect(await readAnswer(reply(409, { error: 'quota', scope: 'user', max: 50, plan: 'free' }), pick)).toEqual({
      ok: false,
      problem: 'quota-free',
    })
    expect(await readAnswer(reply(409, { error: 'quota', scope: 'user', max: 10000, plan: 'pro' }), pick)).toEqual({
      ok: false,
      problem: 'quota-user',
    })
    expect(await readAnswer(reply(403, { error: 'pro', feature: 'flashcards' }), pick)).toEqual({
      ok: false,
      problem: 'pro',
    })
    for (const code of ['stale', 'signed_out', 'not_found'] as const) {
      expect(await readAnswer(reply(400, { error: code }), pick)).toEqual({ ok: false, problem: code })
    }
  })

  it('treats anything else as a failure: other codes, a 403 page, a body without the value', async () => {
    expect(await readAnswer(reply(400, { error: 'invalid' }), pick)).toEqual({ ok: false, problem: 'failed' })
    expect(await readAnswer(reply(500, { error: 'failed' }), pick)).toEqual({ ok: false, problem: 'failed' })
    expect(await readAnswer(reply(403, 'Forbidden'), pick)).toEqual({ ok: false, problem: 'failed' })
    expect(await readAnswer(reply(200, {}), pick)).toEqual({ ok: false, problem: 'failed' })
  })
})
