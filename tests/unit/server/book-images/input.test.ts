import { describe, expect, it } from 'vitest'
import { parseImageNumber } from '~/server/book-images/input'

describe('parseImageNumber', () => {
  it.each([
    ['1', 1],
    ['42', 42],
    ['500', 500],
  ])('takes %s', (value, n) => {
    expect(parseImageNumber(value)).toBe(n)
  })

  it.each(['0', '501', '999', '1000', '01', '-1', '1.5', '', ' 1', '1e2', 'abc'])('refuses %j', (value) => {
    expect(parseImageNumber(value)).toBeNull()
  })
})
