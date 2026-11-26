import { describe, expect, it, vi } from 'vitest'
import { createHighlight, deleteHighlight, updateHighlight } from './highlights-client'

const HIGHLIGHT = { id: 'a', color: 'yellow' }

function answer(status: number, body: unknown) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

const sent = (fetch: ReturnType<typeof answer>) => {
  const [path, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
  return [path, JSON.parse(String(init.body))]
}

describe('the highlight requests', () => {
  it('post each change to its route and read the highlight, or ok for a delete', async () => {
    let fetch = answer(200, { highlight: HIGHLIGHT })
    expect(await updateHighlight('a b', { color: 'blue' })).toEqual({ ok: true, value: HIGHLIGHT })
    expect(sent(fetch)).toEqual(['/account/highlights/a%20b', { intent: 'update', color: 'blue' }])
    fetch = answer(200, { ok: true })
    expect(await deleteHighlight('a')).toEqual({ ok: true, value: true })
    expect(sent(fetch)).toEqual(['/account/highlights/a', { intent: 'delete' }])
  })

  it('call a thrown fetch failed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    const request = {
      book: 'pride-and-prejudice',
      position: { chapter: 'one', page: 0 },
      start: 0,
      end: 4,
      text: 'It is',
      color: 'yellow',
    } as const
    expect(await createHighlight(request)).toEqual({ ok: false, problem: 'failed' })
  })
})
