import { describe, expect, it } from 'vitest'
import { bookOf } from '~/server/books/ref'

const ID = '6f1c0000-0000-4000-8000-000000000000'

describe('bookOf', () => {
  it('reads whichever column is set', () => {
    expect(bookOf({ book_slug: 'emma', user_book_id: null })).toEqual({ slug: 'emma', userBookId: null })
    expect(bookOf({ book_slug: null, user_book_id: ID })).toEqual({ slug: null, userBookId: ID })
  })
})
