import { describe, expect, it } from 'vitest'
import { isObject, only } from '~/shared/lib/json-shape'

describe('isObject', () => {
  it('takes a plain object, and refuses null, arrays and primitives', () => {
    expect(isObject({ a: 1 })).toBe(true)
    expect(isObject({})).toBe(true)
    expect(isObject(null)).toBe(false)
    expect(isObject([1])).toBe(false)
    expect(isObject('x')).toBe(false)
    expect(isObject(undefined)).toBe(false)
  })
})

describe('only', () => {
  it('is true when every key is one of those named, missing ones included', () => {
    expect(only({ name: 'x' }, ['name', 'book'])).toBe(true)
    expect(only({}, ['name'])).toBe(true)
    expect(only({ name: 'x', colour: 'red' }, ['name', 'book'])).toBe(false)
  })
})
