import { describe, expect, it } from 'vitest'
import { emptyLibrary, libraryHeading, SIGNED_OUT_EMPTY } from './empty-state'

describe('emptyLibrary', () => {
  it('shows a signed-out visitor who is only browsing the sign-up panel', () => {
    expect(emptyLibrary({ browsing: true, removedAny: false, signedIn: false })).toBe('signed-out')
  })

  it('tells a signed-in reader with nothing removed that the library is empty', () => {
    expect(emptyLibrary({ browsing: true, removedAny: false, signedIn: true })).toBe('empty')
  })

  it('tells a signed-in reader who removed books that they removed every one', () => {
    expect(emptyLibrary({ browsing: true, removedAny: true, signedIn: true })).toBe('removed')
  })

  it.each([
    { removedAny: false, signedIn: false },
    { removedAny: true, signedIn: false },
    { removedAny: false, signedIn: true },
    { removedAny: true, signedIn: true },
  ])('says no results while searching or filtering, whoever is looking (%o)', (viewer) => {
    expect(emptyLibrary({ browsing: false, ...viewer })).toBe('no-results')
  })

  it('shows a signed-out visitor the sign-up panel even if removals were passed', () => {
    expect(emptyLibrary({ browsing: true, removedAny: true, signedIn: false })).toBe('signed-out')
  })
})

describe('SIGNED_OUT_EMPTY', () => {
  it('says what an account is for, and where to make one or sign in', () => {
    expect(SIGNED_OUT_EMPTY).toEqual({
      title: 'Bring your own books.',
      body: 'Create a free account to import EPUB, PDF and Markdown books and save articles.',
      createAccount: { label: 'Create account', href: '/signup' },
      signIn: { label: 'Sign in', href: '/login', next: '/library' },
    })
  })
})

describe('libraryHeading', () => {
  it('shows the counts and names the count while the catalogue has books', () => {
    expect(libraryHeading({ stats: { books: 6 }, removed: [] })).toEqual({
      showsStats: true,
      description: '6 books to read and listen to.',
    })
  })

  it('hides the counts and names none when the catalogue is empty', () => {
    expect(libraryHeading({ stats: { books: 0 }, removed: [] })).toEqual({
      showsStats: false,
      description: 'Your books, to read and listen to.',
    })
  })

  it('keeps the counts for a reader who removed every catalogue book', () => {
    expect(libraryHeading({ stats: { books: 0 }, removed: [{ slug: 'rumi' }] })).toEqual({
      showsStats: true,
      description: '0 books to read and listen to.',
    })
  })
})
