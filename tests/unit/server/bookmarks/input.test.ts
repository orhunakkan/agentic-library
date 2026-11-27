import { describe, expect, it } from 'vitest'
import { parseBookmarkChange, parseBookmarkCreate } from '~/server/bookmarks/input.ts'
import { privateBookSlug } from '~/shared/content/book-slug'

const BOOK_ID = '6f1c2a4e-0000-4000-8000-000000000000'

describe('parseBookmarkCreate', () => {
  it('accepts a chapter position and a printed page', () => {
    expect(parseBookmarkCreate({ book: 'pride-and-prejudice', position: { chapter: 'chapter-6', page: 2 } })).toEqual({
      book: 'pride-and-prejudice',
      position: { chapter: 'chapter-6', page: 2 },
    })
    expect(parseBookmarkCreate({ book: 'confessions-of-al-ghazzali', position: { printedPage: 112 } })).toEqual({
      book: 'confessions-of-al-ghazzali',
      position: { printedPage: 112 },
    })
    expect(
      parseBookmarkCreate({ book: privateBookSlug(BOOK_ID), position: { chapter: 'only', page: 1 } }),
    ).toMatchObject({
      book: privateBookSlug(BOOK_ID),
    })
  })

  it('refuses an unknown field, a bad slug, a bad position and a non-object', () => {
    const good = { book: 'pride-and-prejudice', position: { chapter: 'chapter-6', page: 2 } }
    expect(parseBookmarkCreate({ ...good, text: 'It is a truth' })).toBeNull()
    expect(parseBookmarkCreate({ ...good, book: 'Not A Slug' })).toBeNull()
    expect(parseBookmarkCreate({ ...good, book: '../etc' })).toBeNull()
    expect(parseBookmarkCreate({ ...good, book: 'u-not-a-uuid' })).toBeNull()
    expect(parseBookmarkCreate({ ...good, position: { chapter: 'chapter-6', page: 0 } })).toBeNull()
    expect(parseBookmarkCreate({ ...good, position: { printedPage: 1.5 } })).toBeNull()
    expect(parseBookmarkCreate({ ...good, position: { chapter: 'chapter-6' } })).toBeNull()
    expect(parseBookmarkCreate({ book: good.book })).toBeNull()
    expect(parseBookmarkCreate(null)).toBeNull()
    expect(parseBookmarkCreate([good])).toBeNull()
    expect(parseBookmarkCreate('pride-and-prejudice')).toBeNull()
  })
})

describe('parseBookmarkChange', () => {
  it('accepts only { intent: "delete" }', () => {
    expect(parseBookmarkChange({ intent: 'delete' })).toEqual({ intent: 'delete' })
    expect(parseBookmarkChange({ intent: 'update' })).toBeNull()
    expect(parseBookmarkChange({ intent: 'delete', id: BOOK_ID })).toBeNull()
    expect(parseBookmarkChange({})).toBeNull()
    expect(parseBookmarkChange(null)).toBeNull()
    expect(parseBookmarkChange(['delete'])).toBeNull()
  })
})
