import { describe, expect, it } from 'vitest'
import { findByName, problemText, shelfButton, sortShelves, withBook } from '~/client/features/shelves/shelf-list'
import type { ShelfView } from '~/shared/shelves/contract'

const shelf = (id: string, name: string, books: string[] = []): ShelfView => ({ id, name, books })
const names = (shelves: readonly ShelfView[]) => shelves.map((s) => s.name)

describe('the list', () => {
  it('sorts by name with numbers in order, ignoring case and accents', () => {
    const sorted = sortShelves([shelf('a', 'Shelf 10'), shelf('b', 'shelf 2'), shelf('c', 'Été'), shelf('d', 'Avant')])
    expect(names(sorted)).toEqual(['Avant', 'Été', 'shelf 2', 'Shelf 10'])
  })

  it('puts a book first, without a second copy, and takes it off', () => {
    const a = shelf('a', 'A', ['x', 'y'])
    expect(withBook(a, 'y', true).books).toEqual(['y', 'x'])
    expect(withBook(a, 'z', true).books).toEqual(['z', 'x', 'y'])
    expect(withBook(a, 'x', false)).toEqual(shelf('a', 'A', ['y']))
    expect(withBook(a, 'missing', false).books).toEqual(['x', 'y'])
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
    expect(problemText('limit_shelves')).toBe('You can have up to 50 shelves.')
    expect(problemText('limit_books')).toBe('Your shelves can hold up to 2,000 books in all.')
    expect(problemText('not_found')).toBe('That shelf was deleted on another device.')
    expect(problemText('not_found', { book: true })).toBe('This book is no longer available.')
    expect(problemText('signed_out')).toBe('Your session ended.')
    for (const problem of ['failed', 'offline', 'invalid'] as const) {
      expect(problemText(problem)).toBe('Couldn’t save that. Try again.')
    }
  })
})
