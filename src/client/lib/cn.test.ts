import { describe, expect, it } from 'vitest'
import { cn } from './cn'

describe('cn', () => {
  it('joins the class names it is given and skips the falsy ones', () => {
    expect(cn('a', false, 'b', null, undefined, '', 'c')).toBe('a b c')
    expect(cn()).toBe('')
  })
})
