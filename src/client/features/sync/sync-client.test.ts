import { describe, expect, it, vi } from 'vitest'
import { readState, sendBatch } from './sync-client'

const batch = { reading: [{ book: 'emma', position: { chapter: 'chapter-1', page: 1 }, at: 1 }] }
const answering = (status: number) =>
  vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response('{}', { status }))

describe('sendBatch', () => {
  it('posts the batch as JSON to /account/sync', async () => {
    const fetcher = answering(200)
    expect(await sendBatch(batch, { keepalive: false }, fetcher)).toBe('ok')
    expect(fetcher).toHaveBeenCalledWith('/account/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(batch),
      credentials: 'same-origin',
      keepalive: false,
    })
  })

  it('passes keepalive through', async () => {
    const fetcher = answering(200)
    await sendBatch(batch, { keepalive: true }, fetcher)
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ keepalive: true })
  })

  it.each([
    [401, 'signed_out'],
    [400, 'invalid'],
    [413, 'invalid'],
    [415, 'invalid'],
    [403, 'failed'],
    [500, 'failed'],
  ])('maps %i to %s', async (status, result) => {
    expect(await sendBatch(batch, { keepalive: false }, answering(status))).toBe(result)
  })

  it('reads a network failure as failed', async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    expect(await sendBatch(batch, { keepalive: false }, fetcher)).toBe('failed')
  })
})

describe('readState', () => {
  it('gives what the account answers, and unavailable when the call fails', async () => {
    expect(await readState(async () => ({ state: 'signed_out' }))).toEqual({ state: 'signed_out' })
    expect(
      await readState(async () => {
        throw new Error('offline')
      }),
    ).toEqual({ state: 'unavailable' })
  })
})
