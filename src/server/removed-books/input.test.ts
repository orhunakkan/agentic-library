import { describe, expect, it } from 'vitest'
import { parseRemovedBook } from './input'

describe('parseRemovedBook', () => {
  it('takes a catalogue slug and whether it is removed', () => {
    expect(parseRemovedBook({ book: 'pride-and-prejudice', removed: true })).toEqual({
      book: 'pride-and-prejudice',
      removed: true,
    })
    expect(parseRemovedBook({ book: 'pride-and-prejudice', removed: false })).toEqual({
      book: 'pride-and-prejudice',
      removed: false,
    })
  })

  it('refuses a private book, which is deleted instead', () => {
    expect(parseRemovedBook({ book: 'u-6f1c0000-0000-4000-8000-000000000000', removed: true })).toBeNull()
  })

  it('refuses unknown fields, missing fields, wrong types and a bad slug', () => {
    expect(parseRemovedBook({ book: 'pride-and-prejudice', removed: true, at: 1 })).toBeNull()
    expect(parseRemovedBook({ book: 'pride-and-prejudice' })).toBeNull()
    expect(parseRemovedBook({ removed: true })).toBeNull()
    expect(parseRemovedBook({ book: 'pride-and-prejudice', removed: 'yes' })).toBeNull()
    expect(parseRemovedBook({ book: 'Not A Slug', removed: true })).toBeNull()
    expect(parseRemovedBook({ book: 'x'.repeat(201), removed: true })).toBeNull()
    expect(parseRemovedBook(null)).toBeNull()
    expect(parseRemovedBook(['pride-and-prejudice', true])).toBeNull()
  })
})
