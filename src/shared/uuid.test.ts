import { describe, expect, it } from 'vitest'
import { isUuid } from './uuid'

const id = '0b6e1f4a-3c2d-4e5f-8a9b-1c2d3e4f5a6b'

describe('isUuid', () => {
  it('accepts a lowercase UUID as the database writes one', () => {
    expect(isUuid(id)).toBe(true)
  })

  it('refuses anything else', () => {
    expect(isUuid(id.toUpperCase())).toBe(false)
    expect(isUuid(` ${id} `)).toBe(false)
    expect(isUuid(`{${id}}`)).toBe(false)
    expect(isUuid(id.slice(0, -1))).toBe(false)
    expect(isUuid(`${id.slice(0, -1)}g`)).toBe(false)
    expect(isUuid('')).toBe(false)
    expect(isUuid(`u-${id}`)).toBe(false)
  })
})
