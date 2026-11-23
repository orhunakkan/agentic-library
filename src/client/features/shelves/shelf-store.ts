import type { ShelfView, ShelvesState } from '~/shared/shelves/contract'
import { confirmed, PENDING_PREFIX, removed, renamed, withBook, withPending } from './shelf-list'
import type { ShelfProblem, ShelfResult } from './shelves-client'

export type ShelvesStatus = 'loading' | 'ready' | 'unavailable'

export interface ShelvesSnapshot {
  shelves: ShelfView[]
  status: ShelvesStatus
}

export interface ShelfRequests {
  createShelf(name: string, book?: string): Promise<ShelfResult<ShelfView>>
  renameShelf(id: string, name: string): Promise<ShelfResult<ShelfView>>
  deleteShelf(id: string): Promise<ShelfResult<true>>
  setShelfBook(id: string, book: string, on: boolean): Promise<ShelfResult<ShelfView>>
}

export class ShelfStore {
  private snapshot: ShelvesSnapshot
  private readonly listeners = new Set<() => void>()
  private pending = 0

  constructor(
    private readonly requests: ShelfRequests,
    private readonly changed: () => void,
    initial?: readonly ShelfView[],
  ) {
    this.snapshot = initial ? { shelves: [...initial], status: 'ready' } : { shelves: [], status: 'loading' }
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): ShelvesSnapshot => this.snapshot

  private set(next: Partial<ShelvesSnapshot>) {
    this.snapshot = { ...this.snapshot, ...next }
    for (const listener of this.listeners) listener()
  }

  private update(change: (shelves: ShelfView[]) => ShelfView[]) {
    this.set({ shelves: change(this.snapshot.shelves) })
  }

  reset = (shelves: readonly ShelfView[]) => this.set({ shelves: [...shelves], status: 'ready' })

  load = (read: () => Promise<ShelvesState>): (() => void) => {
    let live = true
    read().then(
      (state) => {
        if (!live) return
        if (state.state === 'ready') this.reset(state.shelves)
        else this.set({ status: 'unavailable' })
      },
      () => live && this.set({ status: 'unavailable' }),
    )
    return () => {
      live = false
    }
  }

  private refused(id: string, problem: ShelfProblem): ShelfProblem {
    if (problem === 'not_found') this.update((list) => removed(list, id))
    return problem
  }

  create = async (name: string, slug: string): Promise<ShelfProblem | null> => {
    const tempId = `${PENDING_PREFIX}${++this.pending}`
    this.update((list) => withPending(list, tempId, name, slug))
    const result = await this.requests.createShelf(name, slug)
    if (!result.ok) {
      this.update((list) => removed(list, tempId))
      return result.problem
    }
    this.update((list) => confirmed(list, tempId, result.value))
    this.changed()
    return null
  }

  toggle = async (id: string, slug: string, on: boolean): Promise<ShelfProblem | null> => {
    this.update((list) => withBook(list, id, slug, on))
    const result = await this.requests.setShelfBook(id, slug, on)
    if (!result.ok) {
      this.update((list) => withBook(list, id, slug, !on))
      return this.refused(id, result.problem)
    }
    this.changed()
    return null
  }

  rename = async (id: string, name: string): Promise<ShelfProblem | null> => {
    const before = this.snapshot.shelves.find((s) => s.id === id)?.name
    if (before === undefined) return 'not_found'
    this.update((list) => renamed(list, id, name))
    const result = await this.requests.renameShelf(id, name)
    if (!result.ok) {
      this.update((list) => renamed(list, id, before))
      return this.refused(id, result.problem)
    }
    this.update((list) => renamed(list, id, result.value.name))
    this.changed()
    return null
  }

  remove = async (id: string): Promise<ShelfProblem | null> => {
    const result = await this.requests.deleteShelf(id)
    if (!result.ok && result.problem !== 'not_found') return result.problem
    this.update((list) => removed(list, id))
    this.changed()
    return null
  }
}
