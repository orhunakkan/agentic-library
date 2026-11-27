import { describe, expect, it } from 'vitest'
import { activeMainItem, isCollectionActive, shellFor } from '~/client/components/nav-state'
import { privateBookSlug } from '~/shared/content/book-slug'

describe('shellFor', () => {
  it('gives the home page its own frame, and only the home page', () => {
    expect(shellFor('/')).toBe('home')
    expect(shellFor('')).toBe('home')
    for (const path of ['/index', '/home', '//', '/library', '/?']) expect(shellFor(path), path).not.toBe('home')
  })

  it('gives every reader page the reader frame, private books included', () => {
    expect(shellFor('/read/pride-and-prejudice/chapter-1')).toBe('reader')
    expect(shellFor(`/read/${privateBookSlug('00000000-0000-4000-8000-000000000000')}/opening/2`)).toBe('reader')
    expect(shellFor('/reader')).toBe('app')
  })

  it('gives the library, account, sign-in and unknown pages the app frame', () => {
    for (const path of [
      '/library',
      '/library/jane-austen/pride-and-prejudice',
      '/account',
      '/account/highlights',
      '/account/flashcards',
      '/login',
      '/no-such-page',
    ])
      expect(shellFor(path), path).toBe('app')
  })
})

describe('activeMainItem', () => {
  it('marks Library on the unfiltered library and on series and book pages', () => {
    expect(activeMainItem('/library', undefined)).toBe('library')
    expect(activeMainItem('/library/jane-austen', undefined)).toBe('library')
    expect(activeMainItem('/library/jane-austen/pride-and-prejudice', undefined)).toBe('library')
  })

  it('marks Listen for the audio filter, and nothing for a collection filter', () => {
    expect(activeMainItem('/library', 'audio')).toBe('listen')
    expect(activeMainItem('/library', 'classics')).toBeNull()
  })

  it('marks Stats on /account/stats', () => {
    expect(activeMainItem('/account/stats', undefined)).toBe('stats')
    expect(activeMainItem('/account/stats/', undefined)).toBe('stats')
  })

  it('marks Articles on /account/articles', () => {
    expect(activeMainItem('/account/articles', undefined)).toBe('articles')
    expect(activeMainItem('/account/articles/', undefined)).toBe('articles')
  })

  it('marks My books on /account/books and below', () => {
    expect(activeMainItem('/account/books', undefined)).toBe('my-books')
    expect(activeMainItem('/account/books/123', undefined)).toBe('my-books')
    expect(activeMainItem('/account', undefined)).toBeNull()
    expect(activeMainItem('/account/api-keys', undefined)).toBeNull()
  })

  it('marks Highlights on /account/highlights, with or without a book', () => {
    expect(activeMainItem('/account/highlights', undefined)).toBe('highlights')
    expect(activeMainItem('/account/highlights/', undefined)).toBe('highlights')
    expect(activeMainItem('/account/highlights/export/pride-and-prejudice', undefined)).toBeNull()
  })

  it('marks Repositories on the list and in the viewer', () => {
    expect(activeMainItem('/account/repos', undefined)).toBe('repos')
    expect(activeMainItem('/account/repos/0b6f1c4e-0000-4000-8000-000000000000', undefined)).toBe('repos')
  })

  it('marks no sidebar item on /account/flashcards: Flashcards is in the account nav and menu only', () => {
    expect(activeMainItem('/account/flashcards', undefined)).toBeNull()
    expect(activeMainItem('/account/flashcards/', undefined)).toBeNull()
  })

  it('marks nothing in the reader or on sign-in', () => {
    expect(activeMainItem('/read/pride-and-prejudice/chapter-1', undefined)).toBeNull()
    expect(activeMainItem('/login', undefined)).toBeNull()
  })
})

describe('isCollectionActive', () => {
  const classics = { slug: 'classics', href: '/library?filter=classics' }
  const paged = { slug: 'inner-path', href: '/library/inner-path' }

  it('follows the library filter', () => {
    expect(isCollectionActive(classics, '/library', 'classics')).toBe(true)
    expect(isCollectionActive(classics, '/library', 'audio')).toBe(false)
    expect(isCollectionActive(classics, '/library', undefined)).toBe(false)
  })

  it('matches a collection whose link is its own page', () => {
    expect(isCollectionActive(paged, '/library/inner-path', undefined)).toBe(true)
    expect(isCollectionActive(paged, '/library/inner-path/confessions', undefined)).toBe(false)
    expect(isCollectionActive(classics, '/library/poetry-of-the-spirit', undefined)).toBe(false)
  })
})
