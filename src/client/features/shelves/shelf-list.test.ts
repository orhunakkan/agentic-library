import { describe, expect, it } from 'vitest'
import type { ShelfView } from '~/shared/shelves/contract'
import {
  confirmed,
  findByName,
  isPending,
  problemText,
  removed,
  renamed,
  shelfButton,
  sortShelves,
  withBook,
  withPending,
} from './shelf-list'

const shelf = (id: string, name: string, books: string[] = []): ShelfView => ({ id, name, books })
const names = (shelves: readonly ShelfView[]) => shelves.map((s) => s.name)

describe('the list', () => {
  it('sorts by name with numbers in order, ignoring case and accents', () => {
    const sorted = sortShelves([shelf('a', 'Shelf 10'), shelf('b', 'shelf 2'), shelf('c', 'Été'), shelf('d', 'Avant')])
    expect(names(sorted)).toEqual(['Avant', 'Été', 'shelf 2', 'Shelf 10'])
  })

  it('puts a book first, without a second copy, and takes it off', () => {
    const list = [shelf('a', 'A', ['x', 'y']), shelf('b', 'B', ['x'])]
    expect(withBook(list, 'a', 'y', true)[0]?.books).toEqual(['y', 'x'])
    expect(withBook(list, 'a', 'z', true)[0]?.books).toEqual(['z', 'x', 'y'])
    expect(withBook(list, 'a', 'x', false)).toEqual([shelf('a', 'A', ['y']), shelf('b', 'B', ['x'])])
    expect(withBook(list, 'a', 'missing', false)[0]?.books).toEqual(['x', 'y'])
  })

  it('renames in place and sorts again, and removes', () => {
    const list = [shelf('a', 'Apple'), shelf('b', 'Banana')]
    expect(names(renamed(list, 'a', 'Cherry'))).toEqual(['Banana', 'Cherry'])
    expect(removed(list, 'a')).toEqual([shelf('b', 'Banana')])
  })

  it('swaps a pending shelf for the server’s, keeping the order', () => {
    const list = [shelf('a', 'Apple'), shelf('c', 'Cherry')]
    const pending = withPending(list, 'pending-1', 'Banana', 'x')
    expect(pending.map((s) => s.id)).toEqual(['a', 'pending-1', 'c'])
    expect(isPending('pending-1')).toBe(true)
    expect(isPending('a')).toBe(false)
    const real = shelf('b', 'Banana', ['x'])
    expect(confirmed(pending, 'pending-1', real)).toEqual([list[0], real, list[1]])
  })

  it('finds a shelf by name, ignoring case and accents', () => {
    const list = [shelf('a', 'To read'), shelf('b', 'İstanbul')]
    expect(findByName(list, 'TO RÉAD')?.id).toBe('a')
    expect(findByName(list, ' to   read ')?.id).toBe('a')
    expect(findByName(list, 'istanbul')?.id).toBe('b')
    expect(findByName(list, 'To reads')).toBeUndefined()
    expect(findByName(list, '   ')).toBeUndefined()
  })
})

describe('shelfButton', () => {
  const list = [shelf('a', 'To read', ['x', 'y']), shelf('b', 'Later', ['y']), shelf('c', 'Gifts', ['y'])]

  it('says none, the one shelf, or how many', () => {
    expect(shelfButton(list, 'z')).toEqual({ kind: 'none' })
    expect(shelfButton(null, 'x')).toEqual({ kind: 'none' })
    expect(shelfButton(list, 'x')).toEqual({ kind: 'one', name: 'To read' })
    expect(shelfButton(list, 'y')).toEqual({ kind: 'many', count: 3 })
  })
})

describe('problemText', () => {
  it('has the copy for each problem', () => {
    expect(problemText('duplicate', { name: 'To read' })).toBe('You already have a shelf called “To read”.')
    expect(problemText('duplicate')).toBe('You already have a shelf by that name.')
    expect(problemText('quota_shelves')).toBe('You can have up to 50 shelves.')
    expect(problemText('quota_books')).toBe('Your shelves can hold up to 2,000 books in all.')
    expect(problemText('not_found')).toBe('That shelf was deleted on another device.')
    expect(problemText('not_found', { book: true })).toBe('This book is no longer available.')
    expect(problemText('signed_out')).toBe('Your session ended.')
    for (const problem of ['failed', 'offline', 'invalid'] as const) {
      expect(problemText(problem)).toBe('Couldn’t save that. Try again.')
    }
  })
})
