import { describe, expect, it, vi } from 'vitest'
import type { ShelfView, ShelvesState } from '~/shared/shelves/contract'
import { type ShelfDeps, ShelfStore, statusOf } from './shelf-store'
import type { ShelfProblem, ShelfResult } from './shelves-client'

const shelf = (id: string, name: string, books: string[] = []): ShelfView => ({ id, name, books })
const ok = <T>(value: T): ShelfResult<T> => ({ ok: true, value })
const no = (problem: ShelfProblem): ShelfResult<never> => ({ ok: false, problem })

function setup(initial?: ShelfView[]) {
  const deps = {
    load: vi.fn<ShelfDeps['load']>(),
    createShelf: vi.fn<ShelfDeps['createShelf']>(),
    renameShelf: vi.fn<ShelfDeps['renameShelf']>(),
    deleteShelf: vi.fn<ShelfDeps['deleteShelf']>(),
    setShelfBook: vi.fn<ShelfDeps['setShelfBook']>(),
    changed: vi.fn(),
  }
  const store = new ShelfStore(deps, initial)
  const shelves = () => store.getSnapshot().items.map(({ key: _, pending: __, ...s }) => s)
  const status = () => statusOf(store.getSnapshot().state)
  return { store, deps, changed: deps.changed, shelves, status }
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
    expect(setup().status()).toBe('loading')
    const { store, shelves, status } = setup([shelf('a', 'A')])
    expect(status()).toBe('ready')
    expect(shelves()).toEqual([shelf('a', 'A')])
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    store.loaded([shelf('b', 'B')])
    expect(listener).toHaveBeenCalledTimes(1)
    expect(shelves()).toEqual([shelf('b', 'B')])
    unsubscribe()
    store.loaded([])
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('keeps the same snapshot until something changes', () => {
    const { store } = setup([])
    expect(store.getSnapshot()).toBe(store.getSnapshot())
  })

  it('loads the list, and says unavailable when it can’t or the reader is signed out', async () => {
    const ready = setup()
    ready.deps.load.mockResolvedValue({ state: 'ready', shelves: [shelf('a', 'A')] })
    ready.store.start({ signedIn: true })
    await vi.waitFor(() => expect(ready.status()).toBe('ready'))
    expect(ready.shelves()).toEqual([shelf('a', 'A')])

    for (const answer of [{ state: 'unavailable' }, { state: 'signed_out' }] as const) {
      const down = setup()
      down.deps.load.mockResolvedValue(answer)
      down.store.start({ signedIn: true })
      await vi.waitFor(() => expect(down.status()).toBe('unavailable'))
    }

    const thrown = setup()
    thrown.deps.load.mockRejectedValue(new Error('offline'))
    thrown.store.start({ signedIn: true })
    await vi.waitFor(() => expect(thrown.status()).toBe('unavailable'))
  })

  it('shows a new shelf at once under a temporary key, then as the server’s', async () => {
    const { store, deps, changed, shelves } = setup([shelf('c', 'Cherry')])
    const answer = deferred<ShelfResult<ShelfView>>()
    deps.createShelf.mockReturnValue(answer.promise)
    const done = store.create('Banana', 'book')
    expect(deps.createShelf).toHaveBeenCalledWith('Banana', 'book')
    expect(shelves().map((s) => s.name)).toEqual(['Banana', 'Cherry'])
    expect(store.getSnapshot().items[0]).toMatchObject({ key: 'new-1', pending: true })
    answer.resolve(ok(shelf('b', 'Banana', ['book'])))
    expect(await done).toBeNull()
    expect(shelves()).toEqual([shelf('b', 'Banana', ['book']), shelf('c', 'Cherry')])
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('takes a refused new shelf back out', async () => {
    const { store, deps, changed, shelves } = setup([])
    deps.createShelf.mockResolvedValue(no('limit_shelves'))
    expect(await store.create('Banana', 'book')).toBe('limit_shelves')
    expect(shelves()).toEqual([])
    expect(changed).not.toHaveBeenCalled()
  })

  it('shows a new shelf once when its create finishes while a reload is on its way', async () => {
    const { store, deps, shelves } = setup()
    const reload = deferred<ShelvesState>()
    deps.load.mockReturnValue(reload.promise)
    store.start({ signedIn: true })
    deps.createShelf.mockResolvedValue(ok(shelf('b', 'Banana', ['book'])))
    expect(await store.create('Banana', 'book')).toBeNull()
    reload.resolve({ state: 'ready', shelves: [shelf('a', 'Apple'), shelf('b', 'Banana', ['book'])] })
    await vi.waitFor(() => expect(store.getSnapshot().state).toBe('ready'))
    expect(shelves()).toEqual([shelf('a', 'Apple'), shelf('b', 'Banana', ['book'])])
  })

  it('keeps a new shelf the page’s list doesn’t have yet, and shows it once when it does', async () => {
    const { store, deps, shelves } = setup([shelf('a', 'Apple')])
    const answer = deferred<ShelfResult<ShelfView>>()
    deps.createShelf.mockReturnValue(answer.promise)
    const done = store.create('Banana', 'book')
    store.loaded([shelf('a', 'Apple')])
    expect(shelves().map((s) => s.name)).toEqual(['Apple', 'Banana'])
    answer.resolve(ok(shelf('b', 'Banana', ['book'])))
    await done
    store.loaded([shelf('a', 'Apple')])
    expect(shelves()).toEqual([shelf('a', 'Apple'), shelf('b', 'Banana', ['book'])])
    store.loaded([shelf('a', 'Apple'), shelf('b', 'Banana', ['book'])])
    expect(shelves()).toEqual([shelf('a', 'Apple'), shelf('b', 'Banana', ['book'])])
  })

  it('ticks at once, and unticks when the server refuses', async () => {
    const { store, deps, changed, shelves } = setup([shelf('a', 'A', ['x'])])
    const answer = deferred<ShelfResult<ShelfView>>()
    deps.setShelfBook.mockReturnValue(answer.promise)
    const done = store.toggle('a', 'y', true)
    expect(shelves()[0]?.books).toEqual(['y', 'x'])
    answer.resolve(ok(shelf('a', 'A', ['y', 'x'])))
    expect(await done).toBeNull()
    expect(deps.setShelfBook).toHaveBeenCalledWith('a', 'y', true)
    expect(changed).toHaveBeenCalledTimes(1)

    deps.setShelfBook.mockResolvedValue(no('limit_books'))
    expect(await store.toggle('a', 'z', true)).toBe('limit_books')
    expect(shelves()[0]?.books).toEqual(['y', 'x'])
    deps.setShelfBook.mockResolvedValue(no('offline'))
    expect(await store.toggle('a', 'x', false)).toBe('offline')
    expect(shelves()[0]?.books).toEqual(['y', 'x'])
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('drops a shelf the server no longer has', async () => {
    const { store, deps, shelves } = setup([shelf('a', 'A'), shelf('b', 'B')])
    deps.setShelfBook.mockResolvedValue(no('not_found'))
    expect(await store.toggle('a', 'x', true)).toBe('not_found')
    expect(shelves()).toEqual([shelf('b', 'B')])
    deps.renameShelf.mockResolvedValue(no('not_found'))
    expect(await store.rename('b', 'C')).toBe('not_found')
    expect(shelves()).toEqual([])
  })

  it('renames at once, takes the server’s name, and puts the old one back when refused', async () => {
    const { store, deps, changed, shelves } = setup([shelf('a', 'Apple'), shelf('b', 'Banana')])
    deps.renameShelf.mockResolvedValue(ok(shelf('a', 'Cherry')))
    const done = store.rename('a', 'Cherry')
    expect(shelves().map((s) => s.name)).toEqual(['Banana', 'Cherry'])
    expect(await done).toBeNull()
    expect(changed).toHaveBeenCalledTimes(1)

    deps.renameShelf.mockResolvedValue(no('duplicate'))
    expect(await store.rename('a', 'Banana')).toBe('duplicate')
    expect(shelves().map((s) => s.name)).toEqual(['Banana', 'Cherry'])
    expect(await store.rename('missing', 'X')).toBe('not_found')
    expect(deps.renameShelf).toHaveBeenCalledTimes(2)
  })

  it('deletes once the server has, counts one already gone as deleted, and keeps it when it fails', async () => {
    const { store, deps, changed, shelves } = setup([shelf('a', 'A'), shelf('b', 'B'), shelf('c', 'C')])
    deps.deleteShelf.mockResolvedValue(no('failed'))
    expect(await store.removeShelf('a')).toBe('failed')
    expect(shelves()).toHaveLength(3)
    const answer = deferred<ShelfResult<true>>()
    deps.deleteShelf.mockReturnValue(answer.promise)
    const done = store.removeShelf('a')
    expect(shelves()).toHaveLength(3)
    answer.resolve(ok(true))
    expect(await done).toBeNull()
    deps.deleteShelf.mockResolvedValue(no('not_found'))
    expect(await store.removeShelf('b')).toBeNull()
    expect(shelves()).toEqual([shelf('c', 'C')])
    expect(changed).toHaveBeenCalledTimes(2)
  })
})
