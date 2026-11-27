import { describe, expect, it, vi } from 'vitest'
import { createShelf, deleteShelf, renameShelf, setShelfBook } from '~/client/features/shelves/shelves-client'
import type { ShelfAnswer, ShelfDeletedAnswer, ShelfErrorAnswer, ShelfView } from '~/shared/shelves/contract'

const SHELF = {
  id: '6f1c0000-0000-4000-8000-000000000000',
  name: 'To read',
  books: ['pride-and-prejudice'],
} satisfies ShelfView
const SHELF_ANSWER = { shelf: SHELF } satisfies ShelfAnswer
const DELETED = { deleted: true } satisfies ShelfDeletedAnswer

function answer(status: number, body: unknown) {
  const fetch = vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

const sent = (fetch: ReturnType<typeof answer>) => {
  const [path, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
  return [path, init.method, JSON.parse(String(init.body))]
}

describe('the requests', () => {
  it('post each change to its route', async () => {
    let fetch = answer(201, SHELF_ANSWER)
    await createShelf('To read', 'pride-and-prejudice')
    expect(sent(fetch)).toEqual(['/account/shelves/new', 'POST', { name: 'To read', book: 'pride-and-prejudice' }])
    fetch = answer(201, SHELF_ANSWER)
    await createShelf('Empty')
    expect(sent(fetch)).toEqual(['/account/shelves/new', 'POST', { name: 'Empty' }])
    fetch = answer(200, SHELF_ANSWER)
    await renameShelf(SHELF.id, 'Later')
    expect(sent(fetch)).toEqual([`/account/shelves/${SHELF.id}`, 'POST', { name: 'Later' }])
    fetch = answer(200, DELETED)
    await deleteShelf(SHELF.id)
    expect(sent(fetch)).toEqual([`/account/shelves/${SHELF.id}`, 'POST', { intent: 'delete' }])
    fetch = answer(200, SHELF_ANSWER)
    await setShelfBook(SHELF.id, 'pride-and-prejudice', false)
    expect(sent(fetch)).toEqual([
      `/account/shelves/${SHELF.id}/books`,
      'POST',
      { book: 'pride-and-prejudice', on: false },
    ])
  })

  it('read the shelf, or true for a delete', async () => {
    answer(201, SHELF_ANSWER)
    expect(await createShelf('To read')).toEqual({ ok: true, value: SHELF })
    answer(200, SHELF_ANSWER)
    expect(await setShelfBook(SHELF.id, 'pride-and-prejudice', true)).toEqual({ ok: true, value: SHELF })
    answer(200, DELETED)
    expect(await deleteShelf(SHELF.id)).toEqual({ ok: true, value: true })
  })
})

describe('the problems', () => {
  it('map each status and code', async () => {
    const refusals: [number, ShelfErrorAnswer, string][] = [
      [401, { error: 'signed_out' }, 'signed_out'],
      [404, { error: 'not_found' }, 'not_found'],
      [409, { error: 'duplicate' }, 'duplicate'],
      [409, { error: 'quota', scope: 'shelves', max: 50 }, 'limit_shelves'],
      [409, { error: 'quota', scope: 'shelf_books', max: 2000 }, 'limit_books'],
      [400, { error: 'invalid' }, 'invalid'],
      [413, { error: 'invalid' }, 'invalid'],
      [500, { error: 'failed' }, 'failed'],
    ]
    /** A proxy's error page and codes no server sends, untyped on purpose. */
    const odd: [number, unknown, string][] = [
      [502, '<html>Bad gateway</html>', 'failed'],
      [500, { error: 'something new' }, 'failed'],
      [500, { error: 'constructor' }, 'failed'],
    ]
    for (const [status, body, problem] of [...refusals, ...odd]) {
      answer(status, body)
      expect(await renameShelf(SHELF.id, 'X'), `${status} ${JSON.stringify(body)}`).toEqual({ ok: false, problem })
    }
  })

  it('call a success without what it should hold a failure', async () => {
    answer(200, {})
    expect(await createShelf('X')).toEqual({ ok: false, problem: 'failed' })
    answer(200, { deleted: 'yes' })
    expect(await deleteShelf(SHELF.id)).toEqual({ ok: false, problem: 'failed' })
  })

  it('call a thrown fetch offline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    expect(await setShelfBook(SHELF.id, 'pride-and-prejudice', true)).toEqual({ ok: false, problem: 'offline' })
  })
})
