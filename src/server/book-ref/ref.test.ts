import { describe, expect, it } from 'vitest'
import { bookOf, isBookSlug, refFor, slugOf } from './ref'

const ID = '6f1c0000-0000-4000-8000-000000000000'

describe('isBookSlug', () => {
  it('accepts a catalogue slug and a private book’s u-<uuid>', () => {
    expect(isBookSlug('pride-and-prejudice')).toBe(true)
    expect(isBookSlug('book1')).toBe(true)
    expect(isBookSlug(`u-${ID}`)).toBe(true)
  })

  it('refuses a u- slug that is not a UUID, uppercase, an overlong slug and anything not a slug', () => {
    for (const bad of [
      'u-not-a-uuid',
      'u-book',
      `u-${ID.toUpperCase()}`,
      'Pride-and-prejudice',
      'x'.repeat(201),
      '../etc',
      '-leading',
      'double--dash',
      '',
      5,
      null,
      undefined,
    ]) {
      expect(isBookSlug(bad), String(bad)).toBe(false)
    }
    expect(isBookSlug('x'.repeat(200))).toBe(true)
  })
})

describe('refFor and slugOf', () => {
  it('tell a catalogue slug from a private one, and round-trip', () => {
    expect(refFor('emma')).toEqual({ slug: 'emma', userBookId: null })
    expect(refFor(`u-${ID}`)).toEqual({ slug: null, userBookId: ID })
    for (const slug of ['emma', `u-${ID}`]) expect(slugOf(refFor(slug))).toBe(slug)
  })
})

describe('bookOf', () => {
  it('reads whichever column is set', () => {
    expect(bookOf({ book_slug: 'emma', user_book_id: null })).toEqual({ slug: 'emma', userBookId: null })
    expect(bookOf({ book_slug: null, user_book_id: ID })).toEqual({ slug: null, userBookId: ID })
  })
})
