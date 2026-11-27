import { describe, expect, it, vi } from 'vitest'
import { problemText, readRemovedAnswer, setRemoved } from '~/client/features/removed-books/removed-books-client'
import type { RemovedBookErrorCode } from '~/shared/removed-books/contract'
import type { ErrorAnswer } from '../../../../support/client/answers'

function answer(status: number, body: unknown) {
  const fetch = vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

describe('setRemoved', () => {
  it('posts the book and whether it is removed, and answers its state afterwards', async () => {
    const fetch = answer(200, { book: 'pride-and-prejudice', removed: true })
    expect(await setRemoved('pride-and-prejudice', true)).toEqual({ ok: true, value: true })
    const [path, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect([path, init.method, JSON.parse(String(init.body))]).toEqual([
      '/account/removed-books',
      'POST',
      { book: 'pride-and-prejudice', removed: true },
    ])
    answer(200, { book: 'pride-and-prejudice', removed: false })
    expect(await setRemoved('pride-and-prejudice', false)).toEqual({ ok: true, value: false })
  })

  it('is offline when the request never reaches the server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    expect(await setRemoved('pride-and-prejudice', true)).toEqual({ ok: false, problem: 'offline' })
  })
})

describe('readRemovedAnswer', () => {
  const read = (status: number, body: ErrorAnswer<RemovedBookErrorCode> | Record<string, never>) =>
    readRemovedAnswer(new Response(JSON.stringify(body), { status }))
  /** A body that isn't JSON at all, as a proxy's error page is: untyped on purpose. */
  const readText = (status: number, body: string) => readRemovedAnswer(new Response(body, { status }))

  it('names the problems it knows, and fails for anything else', async () => {
    expect(await read(401, { error: 'signed_out' })).toEqual({ ok: false, problem: 'signed_out' })
    expect(await read(404, { error: 'not_found' })).toEqual({ ok: false, problem: 'not_found' })
    expect(await read(400, { error: 'invalid' })).toEqual({ ok: false, problem: 'failed' })
    expect(await read(500, { error: 'failed' })).toEqual({ ok: false, problem: 'failed' })
    expect(await readText(403, 'Forbidden')).toEqual({ ok: false, problem: 'failed' })
  })

  it('fails on a success that carries no state', async () => {
    expect(await read(200, {})).toEqual({ ok: false, problem: 'failed' })
    expect(await readText(200, 'not json')).toEqual({ ok: false, problem: 'failed' })
  })
})

describe('problemText', () => {
  it('says what went wrong in the reader’s words', () => {
    expect(problemText('signed_out')).toBe('Your session ended.')
    expect(problemText('not_found')).toBe('This book is no longer available.')
    expect(problemText('failed')).toBe('Couldn’t save that. Try again.')
    expect(problemText('offline')).toBe('Couldn’t save that. Try again.')
  })
})
