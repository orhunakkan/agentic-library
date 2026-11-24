import {
  type CollectionState,
  type Entry,
  itemsUnder,
  type NoExtra,
  OptimisticCollection,
} from '~/client/lib/optimistic-collection'
import type { ShelfView, ShelvesState } from '~/shared/shelves/contract'
import { sortShelves, withBook } from './shelf-list'
import type { ShelfProblem, ShelfResult } from './shelves-client'

export type ShelfItem = Entry<ShelfView>

export type ShelvesStatus = 'loading' | 'ready' | 'unavailable'

/** How the reader's shelves show where they are: a list that can't be shown, signed out included, is unavailable. */
export const statusOf = (state: CollectionState): ShelvesStatus =>
  state === 'loading' || state === 'ready' ? state : 'unavailable'

export interface NewShelf {
  name: string
  book: string
}

/** A change to one shelf: a new name, or a book put on or taken off it. */
export type ShelfChange = { name: string } | { book: string; on: boolean }

export interface ShelfRequests {
  createShelf(name: string, book?: string): Promise<ShelfResult<ShelfView>>
  renameShelf(id: string, name: string): Promise<ShelfResult<ShelfView>>
  deleteShelf(id: string): Promise<ShelfResult<true>>
  setShelfBook(id: string, book: string, on: boolean): Promise<ShelfResult<ShelfView>>
}

export interface ShelfDeps extends ShelfRequests {
  load: () => Promise<ShelvesState>
  /** Called once the server has kept a change, so pages that show the shelves load them again. */
  changed: () => void
}

type Refused = (problem: ShelfProblem) => void

/**
 * The reader's shelves, sorted by name. A new shelf, a rename and a ticked book show at once; a delete waits for
 * the server, which asks first. Each change answers with the problem that stopped it, or null.
 */
export class ShelfStore extends OptimisticCollection<ShelfView, NewShelf, ShelfProblem, NoExtra, ShelfChange> {
  constructor(deps: ShelfDeps, initial?: readonly ShelfView[]) {
    const kept = <T>(result: ShelfResult<T>): ShelfResult<T> => {
      if (result.ok) deps.changed()
      return result
    }
    super(
      {
        load: () => itemsUnder('shelves', deps.load()),
        create: async ({ name, book }) => kept(await deps.createShelf(name, book)),
        update: async (id, change) =>
          kept(
            await ('name' in change
              ? deps.renameShelf(id, change.name)
              : deps.setShelfBook(id, change.book, change.on)),
          ),
        apply: (shelf, change) =>
          'name' in change ? { ...shelf, name: change.name } : withBook(shelf, change.book, change.on),
        remove: async (id) => {
          const result = await deps.deleteShelf(id)
          if (result.ok || result.problem === 'not_found') deps.changed()
          return result
        },
        confirmRemoves: true,
        draft: ({ name, book }, key) => ({ id: key, name, books: [book] }),
        refused: () => {},
        order: sortShelves,
      },
      initial ? 'ready' : 'loading',
    )
    if (initial) this.loaded([...initial])
  }

  /** What became of a change: the problem it was refused for, or null when kept; one never sent was not found. */
  private async outcome(send: (refused: Refused) => Promise<boolean>): Promise<ShelfProblem | null> {
    const said: { problem?: ShelfProblem } = {}
    const kept = await send((problem) => {
      said.problem = problem
    })
    return said.problem ?? (kept ? null : 'not_found')
  }

  create = (name: string, book: string): Promise<ShelfProblem | null> =>
    this.outcome(async (refused) => (await this.add({ name, book }, refused).saved) !== null)

  toggle = (key: string, book: string, on: boolean): Promise<ShelfProblem | null> =>
    this.outcome((refused) => this.update(key, { book, on }, refused))

  rename = (key: string, name: string): Promise<ShelfProblem | null> =>
    this.outcome((refused) => this.update(key, { name }, refused))

  /** Deletes the shelf once the server has; one already gone counts as deleted. */
  removeShelf = async (key: string): Promise<ShelfProblem | null> => {
    const problem = await this.outcome(async (refused) => {
      await this.remove(key, refused)
      return true
    })
    return problem === 'not_found' ? null : problem
  }
}
