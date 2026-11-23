import { describe, expect, it } from 'vitest'
import { isBadIsbn, normalizeIsbn } from './isbn'

describe('normalizeIsbn', () => {
  it('takes an ISBN-13 with or without hyphens and spaces', () => {
    expect(normalizeIsbn('9780141439518')).toBe('9780141439518')
    expect(normalizeIsbn('978-0-14-143951-8')).toBe('9780141439518')
    expect(normalizeIsbn(' 978 0 14 143951 8 ')).toBe('9780141439518')
  })

  it('strips urn:isbn: and isbn: prefixes', () => {
    expect(normalizeIsbn('urn:isbn:9780141439518')).toBe('9780141439518')
    expect(normalizeIsbn('ISBN: 978-0-14-143951-8')).toBe('9780141439518')
    expect(normalizeIsbn('ISBN-10 0141439513')).toBe('9780141439518')
  })

  it('converts an ISBN-10, including one ending in X, to a 978 ISBN-13', () => {
    expect(normalizeIsbn('0141439513')).toBe('9780141439518')
    expect(normalizeIsbn('0-8044-2957-X')).toBe('9780804429573')
    expect(normalizeIsbn('080442957x')).toBe('9780804429573')
  })

  it('keeps a 979 ISBN-13', () => {
    expect(normalizeIsbn('979-10-90636-07-1')).toBe('9791090636071')
  })

  it('refuses a wrong check digit, the wrong length, another prefix and letters', () => {
    expect(normalizeIsbn('9780141439519')).toBeNull()
    expect(normalizeIsbn('0141439514')).toBeNull()
    expect(normalizeIsbn('978014143951')).toBeNull()
    expect(normalizeIsbn('9770141439518')).toBeNull()
    expect(normalizeIsbn('97801414395AB')).toBeNull()
    expect(normalizeIsbn('https://standardebooks.org/ebooks/jane-austen/pride-and-prejudice')).toBeNull()
    expect(normalizeIsbn('')).toBeNull()
  })
})

describe('isBadIsbn', () => {
  it('lets an empty field through and catches one typed wrong', () => {
    expect(isBadIsbn(null)).toBe(false)
    expect(isBadIsbn(undefined)).toBe(false)
    expect(isBadIsbn('')).toBe(false)
    expect(isBadIsbn('   ')).toBe(false)
    expect(isBadIsbn('978-0-14-143951-8')).toBe(false)
    expect(isBadIsbn('978-0-14-143951-9')).toBe(true)
  })
})
