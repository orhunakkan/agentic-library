import { describe, expect, it } from 'vitest'
import { privateHeaders } from '~/server/private-pages'
import { privateBookSlug } from '~/shared/content/book-slug'

const PRIVATE_0B6C = privateBookSlug('0b6c0000-0000-4000-8000-000000000000')

const NO_STORE = { 'cache-control': 'private, no-store' }
const TOKEN_PAGE = { ...NO_STORE, 'referrer-policy': 'strict-origin' }

describe('privateHeaders', () => {
  it('keeps the sign-in, account and private-book pages out of every cache', () => {
    for (const path of [
      '/login',
      '/login/',
      '/logout',
      '/account',
      '/passkeys/challenge',
      '/passkeys/sign-in',
      '/account/api-keys',
      '/account/books/12',
      '/account/books/lookup',
      `/read/${PRIVATE_0B6C}/chapter-1`,
      `/offline/${PRIVATE_0B6C}.json`,
    ]) {
      expect(privateHeaders(path, null), path).toEqual(NO_STORE)
    }
  })

  it('adds a strict referrer policy on the pages a mailed link opens', () => {
    for (const path of ['/confirm-email', '/forgot-password', '/reset-password', '/signup', '/signup/']) {
      expect(privateHeaders(path, null), path).toEqual(TOKEN_PAGE)
    }
  })

  it('keeps every page out of the cache for a visitor with a session cookie', () => {
    for (const cookie of ['session=abc', '__Host-session=abc', 'theme=dark; session=abc', 'a=1;session=abc']) {
      expect(privateHeaders('/library', cookie), cookie).toEqual(NO_STORE)
    }
    expect(privateHeaders('/reset-password', 'session=abc')).toEqual(TOKEN_PAGE)
    expect(privateHeaders('/account/books', null)).toEqual(NO_STORE)
  })

  it('leaves public pages alone for a signed-out visitor', () => {
    for (const path of [
      '/',
      '/library',
      '/library/classics/pride-and-prejudice',
      '/read/pride-and-prejudice/chapter-1',
      '/offline/pride-and-prejudice.json',
      '/privacy',
      '/terms',
      '/copyright',
      '/credits',
      '/loginx',
      '/accounts',
      '/signups',
      '/read/user/chapter-1',
    ]) {
      expect(privateHeaders(path, null), path).toBeNull()
    }
  })

  it('does not take a cookie whose name only ends in "session" for one', () => {
    expect(privateHeaders('/library', 'mysession=abc')).toBeNull()
    expect(privateHeaders('/library', 'theme=session')).toBeNull()
    expect(privateHeaders('/library', '')).toBeNull()
  })

  it('does not give the strict referrer to a page below a mailed link’s page', () => {
    expect(privateHeaders('/signup/extra', null)).toEqual(NO_STORE)
  })
})
