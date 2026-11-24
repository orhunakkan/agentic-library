import { describe, expect, it } from 'vitest'
import { SHELF_CREATE, shelfBook, shelfChange } from './contract'

const ID = '6f1c0000-0000-4000-8000-000000000000'

describe('the shelves endpoints', () => {
  it('name the route each one is served at, with the shelf id escaped', () => {
    expect(SHELF_CREATE.path).toBe('/account/shelves/new')
    expect(shelfChange(ID).path).toBe(`/account/shelves/${ID}`)
    expect(shelfBook(ID).path).toBe(`/account/shelves/${ID}/books`)
    expect(shelfChange('a/b').path).toBe('/account/shelves/a%2Fb')
  })

  it('parse a body into what the server works with, or refuse it', () => {
    expect(SHELF_CREATE.parse({ name: '  To   read ' })).toEqual({ name: 'To read', book: null })
    expect(SHELF_CREATE.parse({ name: 'To read', colour: 'red' })).toBeNull()
    expect(shelfChange(ID).parse({ intent: 'delete' })).toEqual({ kind: 'delete' })
    expect(shelfChange(ID).parse({ name: 'Later', intent: 'delete' })).toBeNull()
    expect(shelfBook(ID).parse({ book: 'pride-and-prejudice', on: false })).toEqual({
      book: 'pride-and-prejudice',
      on: false,
    })
    expect(shelfBook(ID).parse({ book: 'pride-and-prejudice', on: 'true' })).toBeNull()
  })
})
