import { describe, expect, it } from 'vitest'
import { parseRating } from '~/server/ratings/input'
import { privateBookSlug } from '~/shared/content/book-slug'

const PRIVATE = privateBookSlug('6f1c0000-0000-4000-8000-000000000000')

describe('parseRating', () => {
  it('takes a catalogue or private book and its stars', () => {
    expect(parseRating({ book: 'the-prophet', stars: 4 })).toEqual({ book: 'the-prophet', stars: 4 })
    expect(parseRating({ book: PRIVATE, stars: 1 })).toEqual({ book: PRIVATE, stars: 1 })
    expect(parseRating({ book: 'the-prophet', stars: 5 })).toEqual({ book: 'the-prophet', stars: 5 })
  })

  it('takes null stars, which clears the rating', () => {
    expect(parseRating({ book: 'the-prophet', stars: null })).toEqual({ book: 'the-prophet', stars: null })
  })

  it('refuses every other value of stars, a missing one included', () => {
    for (const stars of [0, 6, 2.5, -1, '4', true, false, [4], {}]) {
      expect(parseRating({ book: 'the-prophet', stars })).toBeNull()
    }
    expect(parseRating({ book: 'the-prophet' })).toBeNull()
    expect(parseRating({ book: 'the-prophet', stars: undefined })).toBeNull()
  })

  it('refuses an extra field, a bad slug and anything that isn’t an object', () => {
    expect(parseRating({ book: 'the-prophet', stars: 4, at: 1 })).toBeNull()
    expect(parseRating({ stars: 4 })).toBeNull()
    expect(parseRating({ book: 'Not A Slug', stars: 4 })).toBeNull()
    expect(parseRating({ book: 'u-not-a-uuid', stars: 4 })).toBeNull()
    expect(parseRating({ book: 'x'.repeat(201), stars: 4 })).toBeNull()
    expect(parseRating({ book: 7, stars: 4 })).toBeNull()
    expect(parseRating(null)).toBeNull()
    expect(parseRating('the-prophet')).toBeNull()
    expect(parseRating(['the-prophet', 4])).toBeNull()
  })
})
