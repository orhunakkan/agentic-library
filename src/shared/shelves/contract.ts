export interface ShelfView {
  id: string
  name: string
  books: string[]
}

export interface ShelfCreateBody {
  name: string
  book?: string
}

export type ShelfChangeBody = { name: string } | { intent: 'delete' }

export interface ShelfBookBody {
  book: string
  on: boolean
}

export interface ShelfAnswer {
  shelf: ShelfView
}

export interface ShelfDeletedAnswer {
  deleted: true
}

export type ShelfErrorCode = 'signed_out' | 'not_found' | 'invalid' | 'duplicate' | 'quota' | 'failed'

export type ShelfErrorAnswer =
  | { error: Exclude<ShelfErrorCode, 'quota'> }
  | { error: 'quota'; scope: 'shelves' | 'shelf_books'; max: number }

export type ShelvesState = { state: 'signed_out' } | { state: 'unavailable' } | { state: 'ready'; shelves: ShelfView[] }
