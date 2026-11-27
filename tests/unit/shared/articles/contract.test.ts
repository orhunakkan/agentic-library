import { describe, expect, it } from 'vitest'
import { siteOf } from '~/shared/articles/contract'

describe('siteOf', () => {
  it('is the host without www.', () => {
    expect(siteOf('https://www.Example.com/a')).toBe('example.com')
    expect(siteOf('http://127.0.0.1:3100/x')).toBe('127.0.0.1')
  })
  it('is empty for what isn’t an address', () => expect(siteOf('not a url')).toBe(''))
})
