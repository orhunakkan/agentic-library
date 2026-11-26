import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountHookAt } from '~/client/testing/router'
import type { ShelfView, ShelvesState } from '~/shared/shelves/contract'
import type { ShelfResult } from './shelves-client'
import { useShelves } from './use-shelves'

/** The shelf list the hook loads itself when the page has none; each test says what the server answers. */
const server = vi.hoisted(() => ({ getShelves: vi.fn() }))
vi.mock('~/server/account-functions', () => server)

/** The shelf endpoints, answered per test. */
const requests = vi.hoisted(() => ({
  createShelf: vi.fn(),
  renameShelf: vi.fn(),
  deleteShelf: vi.fn(),
  setShelfBook: vi.fn(),
}))
vi.mock('./shelves-client', () => requests)

const favourites: ShelfView = { id: 's1', name: 'Favourites', books: ['moby-dick'] }
const toRead: ShelfView = { id: 's2', name: 'To read', books: [] }
const classics: ShelfView = { id: 's3', name: 'Classics', books: ['emma'] }

const names = (shelves: readonly ShelfView[]) => shelves.map((shelf) => shelf.name)

/**
 * Waits until every promise callback already queued has run, so an answer the hook should ignore has had its chance
 * to show. It waits for the next task, not for any length of time.
 */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

const mountShelves = (props: { initial?: readonly ShelfView[] } = {}) =>
  mountHookAt('/library', useShelves, props, { context: { viewer: { username: 'reader' } } })

beforeEach(() => {
  server.getShelves.mockReturnValue(new Promise<ShelvesState>(() => {}))
})

describe('useShelves', () => {
  it('shows the page’s shelves at once, sorted, without loading them again', async () => {
    const hook = await mountShelves({ initial: [toRead, favourites] })
    expect(hook.current.status).toBe('ready')
    expect(names(hook.current.shelves)).toEqual(['Favourites', 'To read'])
    expect(server.getShelves).not.toHaveBeenCalled()
  })

  it('loads the shelves itself when the page has none', async () => {
    const answer = Promise.withResolvers<ShelvesState>()
    server.getShelves.mockReturnValue(answer.promise)
    const hook = await mountShelves()
    expect(hook.current.status).toBe('loading')
    expect(hook.current.shelves).toEqual([])

    answer.resolve({ state: 'ready', shelves: [toRead, classics] })
    await vi.waitFor(() => expect(hook.current.status).toBe('ready'))
    expect(names(hook.current.shelves)).toEqual(['Classics', 'To read'])
    expect(server.getShelves).toHaveBeenCalledOnce()
  })

  it('is unavailable when the server can’t give the shelves, signed out included', async () => {
    server.getShelves.mockResolvedValue({ state: 'signed_out' })
    const hook = await mountShelves()
    await vi.waitFor(() => expect(hook.current.status).toBe('unavailable'))
  })

  it('follows a new list from the page', async () => {
    const hook = await mountShelves({ initial: [favourites] })
    hook.rerender({ initial: [favourites, classics] })
    await vi.waitFor(() => expect(names(hook.current.shelves)).toEqual(['Classics', 'Favourites']))
  })

  it('ignores its own load when the page’s list arrives first', async () => {
    const answer = Promise.withResolvers<ShelvesState>()
    server.getShelves.mockReturnValue(answer.promise)
    const hook = await mountShelves()

    hook.rerender({ initial: [favourites] })
    await vi.waitFor(() => expect(names(hook.current.shelves)).toEqual(['Favourites']))
    answer.resolve({ state: 'ready', shelves: [toRead] })
    await settled()

    expect(names(hook.current.shelves)).toEqual(['Favourites'])
    expect(hook.current.status).toBe('ready')
  })

  it('ticks a book on a shelf at once, and takes it off again when the server refuses', async () => {
    const answer = Promise.withResolvers<ShelfResult<ShelfView>>()
    requests.setShelfBook.mockReturnValue(answer.promise)
    const hook = await mountShelves({ initial: [toRead] })
    const invalidate = vi.spyOn(hook.router, 'invalidate')

    const result = hook.current.toggle('s2', 'emma', true)
    await vi.waitFor(() => expect(hook.current.shelves[0]?.books).toEqual(['emma']))
    answer.resolve({ ok: false, problem: 'limit_books' })

    expect(await result).toBe('limit_books')
    await vi.waitFor(() => expect(hook.current.shelves[0]?.books).toEqual([]))
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('has the library page load its shelves again once the server keeps a change', async () => {
    requests.renameShelf.mockResolvedValue({ ok: true, value: { ...toRead, name: 'Next up' } })
    const hook = await mountShelves({ initial: [toRead] })
    const invalidate = vi.spyOn(hook.router, 'invalidate').mockResolvedValue()

    expect(await hook.current.rename('s2', 'Next up')).toBeNull()

    await vi.waitFor(() => expect(names(hook.current.shelves)).toEqual(['Next up']))
    expect(invalidate).toHaveBeenCalledOnce()
    const filter = invalidate.mock.calls[0]?.[0]?.filter
    /** The filter reads only a match's route id; a whole route match is more than this test needs to build. */
    expect(filter?.({ routeId: '/library/' } as never)).toBe(true)
    expect(filter?.({ routeId: '/' } as never)).toBe(false)
  })
})
