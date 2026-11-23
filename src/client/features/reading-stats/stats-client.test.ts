import { afterEach, describe, expect, it, vi } from 'vitest'
import { saveGoal, setFinished } from './stats-client'

function answer(status: number, body: unknown) {
  const fetch = vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

afterEach(() => vi.unstubAllGlobals())

describe('saveGoal', () => {
  it('posts the minutes and the zone, and gives the saved goal', async () => {
    const fetch = answer(200, { goal: { minutes: 30, fromDay: '2026-11-21' } })
    expect(await saveGoal(30, 'Europe/Istanbul')).toEqual({ ok: true, value: { minutes: 30, fromDay: '2026-11-21' } })
    expect(fetch).toHaveBeenCalledWith('/account/stats/goal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ minutes: 30, zone: 'Europe/Istanbul' }),
    })
  })

  it('maps each refusal, a garbled answer and a network failure', async () => {
    answer(400, { error: 'invalid' })
    expect(await saveGoal(25, 'UTC')).toEqual({ ok: false, problem: 'invalid' })
    answer(401, { error: 'signed_out' })
    expect(await saveGoal(30, 'UTC')).toEqual({ ok: false, problem: 'signed_out' })
    answer(500, { error: 'failed' })
    expect(await saveGoal(30, 'UTC')).toEqual({ ok: false, problem: 'failed' })
    answer(502, 'Bad gateway')
    expect(await saveGoal(30, 'UTC')).toEqual({ ok: false, problem: 'failed' })
    answer(200, { goal: { minutes: '30' } })
    expect(await saveGoal(30, 'UTC')).toEqual({ ok: false, problem: 'failed' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    expect(await saveGoal(30, 'UTC')).toEqual({ ok: false, problem: 'failed' })
  })
})

describe('setFinished', () => {
  it('posts the book and whether it is finished, and says whether this made the mark', async () => {
    const fetch = answer(200, { book: 'emma', finished: true, added: true })
    expect(await setFinished('emma', true)).toEqual({ ok: true, value: { book: 'emma', finished: true, added: true } })
    expect(fetch).toHaveBeenCalledWith('/account/stats/finished', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ book: 'emma', finished: true }),
    })
  })

  it('maps each refusal, a garbled answer and a network failure', async () => {
    for (const code of ['invalid', 'signed_out', 'not_found', 'failed'] as const) {
      answer(code === 'not_found' ? 404 : 400, { error: code })
      expect(await setFinished('emma', false)).toEqual({ ok: false, problem: code })
    }
    answer(418, { error: 'teapot' })
    expect(await setFinished('emma', false)).toEqual({ ok: false, problem: 'failed' })
    answer(200, { book: 'emma' })
    expect(await setFinished('emma', false)).toEqual({ ok: false, problem: 'failed' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    expect(await setFinished('emma', true)).toEqual({ ok: false, problem: 'failed' })
  })
})
