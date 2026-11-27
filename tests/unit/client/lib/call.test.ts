import { describe, expect, it, vi } from 'vitest'
import { call } from '~/client/lib/call'
import { endpoint } from '~/shared/lib/endpoint'

type Refusal = { error: 'not_found' } | { error: 'quota'; max: number }

const NOTE = endpoint<{ text: string }, { note: string }, Refusal>()({
  path: '/account/notes/new',
  parse: (value) => value,
})

function answer(status: number, body: unknown) {
  const fetch = vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

describe('call', () => {
  it('posts the body as JSON to the endpoint’s path and gives back its answer', async () => {
    const fetch = answer(201, { note: 'hello' })
    expect(await call(NOTE, { text: 'hello' })).toEqual({ ok: true, answer: { note: 'hello' } })
    expect(fetch).toHaveBeenCalledWith('/account/notes/new', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"text":"hello"}',
    })
  })

  it('gives back a refusal as the endpoint sent it, extras included', async () => {
    answer(409, { error: 'quota', max: 3 })
    expect(await call(NOTE, { text: 'x' })).toEqual({ ok: false, refusal: { error: 'quota', max: 3 } })
    answer(404, { error: 'not_found' })
    expect(await call(NOTE, { text: 'x' })).toEqual({ ok: false, refusal: { error: 'not_found' } })
  })

  it('calls an answer that isn’t a JSON object, or a refusal without a code, failed', async () => {
    answer(502, '<html>Bad gateway</html>')
    expect(await call(NOTE, { text: 'x' })).toEqual({ ok: false, refusal: { error: 'failed' } })
    answer(200, '"just a string"')
    expect(await call(NOTE, { text: 'x' })).toEqual({ ok: false, refusal: { error: 'failed' } })
    answer(500, { message: 'oops' })
    expect(await call(NOTE, { text: 'x' })).toEqual({ ok: false, refusal: { error: 'failed' } })
  })

  it('calls a thrown fetch offline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    expect(await call(NOTE, { text: 'x' })).toEqual({ ok: false, refusal: { error: 'offline' } })
  })
})
