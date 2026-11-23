import { describe, expect, it } from 'vitest'
import { isBookSlug, parseBookSlug, privateBookSlug, refFor, slugOf } from './book-slug'

const ID = '6f1c0000-0000-4000-8000-000000000000'

describe('parseBookSlug', () => {
  it('reads a catalogue book’s slug', () => {
    expect(parseBookSlug('pride-and-prejudice')).toEqual({ kind: 'catalogue', slug: 'pride-and-prejudice' })
    expect(parseBookSlug('book1')).toEqual({ kind: 'catalogue', slug: 'book1' })
    expect(parseBookSlug('x'.repeat(200))).toEqual({ kind: 'catalogue', slug: 'x'.repeat(200) })
  })

  it('reads a private book’s id from u-<uuid>', () => {
    expect(parseBookSlug(`u-${ID}`)).toEqual({ kind: 'private', id: ID })
  })

  it('refuses u- followed by anything but a lowercase uuid, and a catalogue-looking slug starting with u-', () => {
    for (const bad of ['u-not-a-uuid', 'u-book', 'u-0e0f', `u-${ID.toUpperCase()}`, `u-${ID}-x`, 'u-']) {
      expect(parseBookSlug(bad), bad).toBeNull()
    }
  })

  it('refuses an overlong slug and anything that is not a slug', () => {
    for (const bad of [
      'x'.repeat(201),
      'Pride-and-prejudice',
      '../etc',
      '-leading',
      'trailing-',
      'double--dash',
      '',
      5,
      null,
      undefined,
      {},
    ]) {
      expect(parseBookSlug(bad), String(bad)).toBeNull()
      expect(isBookSlug(bad), String(bad)).toBe(false)
    }
  })
})

describe('privateBookSlug', () => {
  it('round-trips through parseBookSlug', () => {
    expect(parseBookSlug(privateBookSlug(ID))).toEqual({ kind: 'private', id: ID })
  })
})

describe('refFor and slugOf', () => {
  it('tell a catalogue slug from a private one, and round-trip', () => {
    expect(refFor('emma')).toEqual({ slug: 'emma', userBookId: null })
    expect(refFor(privateBookSlug(ID))).toEqual({ slug: null, userBookId: ID })
    for (const slug of ['emma', privateBookSlug(ID)]) expect(slugOf(refFor(slug))).toBe(slug)
  })
})
