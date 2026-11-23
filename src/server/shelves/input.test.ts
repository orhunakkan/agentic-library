import { describe, expect, it } from 'vitest'
import { parseShelfBook, parseShelfChange, parseShelfCreate } from './input'

const PRIVATE = 'u-6f1c0000-0000-4000-8000-000000000000'

describe('parseShelfCreate', () => {
  it('takes a name, and a book when there is one, with the name cleaned', () => {
    expect(parseShelfCreate({ name: '  To   read ' })).toEqual({ name: 'To read', book: null })
    expect(parseShelfCreate({ name: 'To read', book: 'pride-and-prejudice' })).toEqual({
      name: 'To read',
      book: 'pride-and-prejudice',
    })
    expect(parseShelfCreate({ name: 'Mine', book: PRIVATE })).toEqual({ name: 'Mine', book: PRIVATE })
  })

  it('refuses unknown fields, a name that isn’t one and a bad slug', () => {
    expect(parseShelfCreate({ name: 'To read', colour: 'red' })).toBeNull()
    expect(parseShelfCreate({ name: 42 })).toBeNull()
    expect(parseShelfCreate({ name: '   ' })).toBeNull()
    expect(parseShelfCreate({ name: 'x'.repeat(41) })).toBeNull()
    expect(parseShelfCreate({ name: `x${' '.repeat(200)}` })).toBeNull()
    expect(parseShelfCreate({ name: 'To read', book: 'Not A Slug' })).toBeNull()
    expect(parseShelfCreate({ name: 'To read', book: null })).toBeNull()
    expect(parseShelfCreate({})).toBeNull()
    expect(parseShelfCreate(null)).toBeNull()
    expect(parseShelfCreate(['To read'])).toBeNull()
  })

  it('cleans a name of up to 200 characters before it counts it', () => {
    expect(parseShelfCreate({ name: `To read${' '.repeat(190)}` })).toEqual({ name: 'To read', book: null })
  })
})

describe('parseShelfChange', () => {
  it('reads a rename or a delete', () => {
    expect(parseShelfChange({ name: ' Later ' })).toEqual({ kind: 'rename', name: 'Later' })
    expect(parseShelfChange({ intent: 'delete' })).toEqual({ kind: 'delete' })
  })

  it('refuses both together, another intent, and a bad name', () => {
    expect(parseShelfChange({ name: 'Later', intent: 'delete' })).toBeNull()
    expect(parseShelfChange({ intent: 'rename' })).toBeNull()
    expect(parseShelfChange({ name: '' })).toBeNull()
    expect(parseShelfChange({ name: 7 })).toBeNull()
    expect(parseShelfChange({ name: 'x'.repeat(201) })).toBeNull()
    expect(parseShelfChange({})).toBeNull()
    expect(parseShelfChange('delete')).toBeNull()
  })
})

describe('parseShelfBook', () => {
  it('reads a book and whether it goes on', () => {
    expect(parseShelfBook({ book: 'pride-and-prejudice', on: true })).toEqual({
      book: 'pride-and-prejudice',
      on: true,
    })
    expect(parseShelfBook({ book: PRIVATE, on: false })).toEqual({ book: PRIVATE, on: false })
  })

  it('refuses `on` that isn’t a boolean, a bad slug and unknown fields', () => {
    expect(parseShelfBook({ book: 'pride-and-prejudice', on: 'true' })).toBeNull()
    expect(parseShelfBook({ book: 'pride-and-prejudice' })).toBeNull()
    expect(parseShelfBook({ book: '../etc', on: true })).toBeNull()
    expect(parseShelfBook({ book: 'pride-and-prejudice', on: true, shelf: 'x' })).toBeNull()
    expect(parseShelfBook(undefined)).toBeNull()
  })
})
