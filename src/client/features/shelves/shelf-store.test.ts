import { describe, expect, it, vi } from 'vitest'
import type { ShelfView, ShelvesState } from '~/shared/shelves/contract'
import { type ShelfRequests, ShelfStore } from './shelf-store'
import type { ShelfProblem, ShelfResult } from './shelves-client'

const shelf = (id: string, name: string, books: string[] = []): ShelfView => ({ id, name, books })
const ok = <T>(value: T): ShelfResult<T> => ({ ok: true, value })
const no = (problem: ShelfProblem): ShelfResult<never> => ({ ok: false, problem })

function setup(initial?: ShelfView[]) {
  const requests = {
    createShelf: vi.fn<ShelfRequests['createShelf']>(),
    renameShelf: vi.fn<ShelfRequests['renameShelf']>(),
    deleteShelf: vi.fn<ShelfRequests['deleteShelf']>(),
    setShelfBook: vi.fn<ShelfRequests['setShelfBook']>(),
  }
  const changed = vi.fn()
  const store = new ShelfStore(requests, changed, initial)
  const shelves = () => store.getSnapshot().shelves
  return { store, requests, changed, shelves }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('ShelfStore', () => {
  it('starts loading without an initial list, ready with one, and tells subscribers of changes', () => {
    expect(setup().store.getSnapshot()).toEqual({ shelves: [], status: 'loading' })
    const { store } = setup([shelf('a', 'A')])
    expect(store.getSnapshot()).toEqual({ shelves: [shelf('a', 'A')], status: 'ready' })
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    store.reset([shelf('b', 'B')])
    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot().shelves).toEqual([shelf('b', 'B')])
    unsubscribe()
    store.reset([])
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('keeps the same snapshot until something changes', () => {
    const { store } = setup([])
    expect(store.getSnapshot()).toBe(store.getSnapshot())
  })

  it('loads the list, says unavailable when it can’t, and drops an answer that comes too late', async () => {
    const ready = setup()
    ready.store.load(async () => ({ state: 'ready', shelves: [shelf('a', 'A')] }))
    await vi.waitFor(() => expect(ready.store.getSnapshot().status).toBe('ready'))
    expect(ready.shelves()).toEqual([shelf('a', 'A')])

    const down = setup()
    down.store.load(async () => ({ state: 'unavailable' }))
    await vi.waitFor(() => expect(down.store.getSnapshot().status).toBe('unavailable'))

    const thrown = setup()
    thrown.store.load(async () => {
      throw new Error('offline')
    })
    await vi.waitFor(() => expect(thrown.store.getSnapshot().status).toBe('unavailable'))

    const late = setup()
    const answer = deferred<ShelvesState>()
    const cancel = late.store.load(() => answer.promise)
    cancel()
    answer.resolve({ state: 'ready', shelves: [shelf('a', 'A')] })
    await answer.promise
    expect(late.store.getSnapshot()).toEqual({ shelves: [], status: 'loading' })
  })

  it('shows a new shelf at once under a temporary id, then as the server’s', async () => {
    const { store, requests, changed, shelves } = setup([shelf('c', 'Cherry')])
    const answer = deferred<ShelfResult<ShelfView>>()
    requests.createShelf.mockReturnValue(answer.promise)
    const done = store.create('Banana', 'book')
    expect(requests.createShelf).toHaveBeenCalledWith('Banana', 'book')
    expect(shelves().map((s) => s.name)).toEqual(['Banana', 'Cherry'])
    expect(shelves()[0]?.id).toMatch(/^pending-/)
    answer.resolve(ok(shelf('b', 'Banana', ['book'])))
    expect(await done).toBeNull()
    expect(shelves()).toEqual([shelf('b', 'Banana', ['book']), shelf('c', 'Cherry')])
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('takes a refused new shelf back out', async () => {
    const { store, requests, changed, shelves } = setup([])
    requests.createShelf.mockResolvedValue(no('quota_shelves'))
    expect(await store.create('Banana', 'book')).toBe('quota_shelves')
    expect(shelves()).toEqual([])
    expect(changed).not.toHaveBeenCalled()
  })

  it('ticks at once, and unticks when the server refuses', async () => {
    const { store, requests, changed, shelves } = setup([shelf('a', 'A', ['x'])])
    const answer = deferred<ShelfResult<ShelfView>>()
    requests.setShelfBook.mockReturnValue(answer.promise)
    const done = store.toggle('a', 'y', true)
    expect(shelves()[0]?.books).toEqual(['y', 'x'])
    answer.resolve(ok(shelf('a', 'A', ['y', 'x'])))
    expect(await done).toBeNull()
    expect(changed).toHaveBeenCalledTimes(1)

    requests.setShelfBook.mockResolvedValue(no('quota_books'))
    expect(await store.toggle('a', 'z', true)).toBe('quota_books')
    expect(shelves()[0]?.books).toEqual(['y', 'x'])
    requests.setShelfBook.mockResolvedValue(no('offline'))
    expect(await store.toggle('a', 'x', false)).toBe('offline')
    expect(shelves()[0]?.books).toEqual(['x', 'y'])
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('drops a shelf the server no longer has', async () => {
    const { store, requests, shelves } = setup([shelf('a', 'A'), shelf('b', 'B')])
    requests.setShelfBook.mockResolvedValue(no('not_found'))
    expect(await store.toggle('a', 'x', true)).toBe('not_found')
    expect(shelves()).toEqual([shelf('b', 'B')])
    requests.renameShelf.mockResolvedValue(no('not_found'))
    expect(await store.rename('b', 'C')).toBe('not_found')
    expect(shelves()).toEqual([])
  })

  it('renames at once, takes the server’s name, and puts the old one back when refused', async () => {
    const { store, requests, changed, shelves } = setup([shelf('a', 'Apple'), shelf('b', 'Banana')])
    requests.renameShelf.mockResolvedValue(ok(shelf('a', 'Cherry')))
    const done = store.rename('a', 'Cherry')
    expect(shelves().map((s) => s.name)).toEqual(['Banana', 'Cherry'])
    expect(await done).toBeNull()
    expect(changed).toHaveBeenCalledTimes(1)

    requests.renameShelf.mockResolvedValue(no('duplicate'))
    expect(await store.rename('a', 'Banana')).toBe('duplicate')
    expect(shelves().map((s) => s.name)).toEqual(['Banana', 'Cherry'])
    expect(await store.rename('missing', 'X')).toBe('not_found')
    expect(requests.renameShelf).toHaveBeenCalledTimes(2)
  })

  it('deletes once the server has, counts one already gone as deleted, and keeps it when it fails', async () => {
    const { store, requests, changed, shelves } = setup([shelf('a', 'A'), shelf('b', 'B'), shelf('c', 'C')])
    requests.deleteShelf.mockResolvedValue(no('failed'))
    expect(await store.remove('a')).toBe('failed')
    expect(shelves()).toHaveLength(3)
    requests.deleteShelf.mockResolvedValue(ok(true))
    expect(await store.remove('a')).toBeNull()
    requests.deleteShelf.mockResolvedValue(no('not_found'))
    expect(await store.remove('b')).toBeNull()
    expect(shelves()).toEqual([shelf('c', 'C')])
    expect(changed).toHaveBeenCalledTimes(2)
  })
})
