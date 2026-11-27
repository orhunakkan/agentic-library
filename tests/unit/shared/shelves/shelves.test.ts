import { describe, expect, it } from 'vitest'
import { cleanShelfName, SHELF_NAME_MAX, shelfFilter, shelfIdOf, shelfNameKey } from '~/shared/shelves/shelves.ts'

describe('cleanShelfName', () => {
  it('trims, collapses whitespace and normalises to NFC', () => {
    expect(cleanShelfName('  To   read \n next ')).toBe('To read next')
    expect(cleanShelfName('a\tb')).toBe('a b')
    expect(cleanShelfName('Café')).toBe('Café')
    expect(cleanShelfName('Café')).toHaveLength(4)
  })

  it('removes control characters', () => {
    expect(cleanShelfName('To\u0000 re\u0007ad')).toBe('To read')
    expect(cleanShelfName('a \u0000 b')).toBe('a b')
  })

  it('refuses empty, blank, control-only and over-long names', () => {
    expect(cleanShelfName('')).toBeNull()
    expect(cleanShelfName('   \n\t ')).toBeNull()
    expect(cleanShelfName('\u0000\u0001\u007f')).toBeNull()
    expect(cleanShelfName('x'.repeat(SHELF_NAME_MAX + 1))).toBeNull()
    expect(cleanShelfName('x'.repeat(SHELF_NAME_MAX))).toBe('x'.repeat(SHELF_NAME_MAX))
  })

  it('counts characters, not UTF-16 units, as the table does', () => {
    expect(cleanShelfName('📚'.repeat(SHELF_NAME_MAX))).toBe('📚'.repeat(SHELF_NAME_MAX))
    expect(cleanShelfName('📚'.repeat(SHELF_NAME_MAX + 1))).toBeNull()
  })

  it('refuses a name whose key would be empty or too long to store', () => {
    expect(cleanShelfName('́')).toBeNull()
    expect(cleanShelfName('ﷺ'.repeat(SHELF_NAME_MAX))).toBeNull()
    expect(cleanShelfName('ﷺ'.repeat(8))).not.toBeNull()
  })

  it('refuses a string with a lone surrogate', () => {
    expect(cleanShelfName('To read \ud800')).toBeNull()
  })
})

describe('shelfNameKey', () => {
  it('is the same for names that differ only in case or accents', () => {
    const keys = ['To Read', 'to read', 'TO READ', 'Tö Read'].map(shelfNameKey)
    expect(new Set(keys).size).toBe(1)
    expect(shelfNameKey('İstanbul')).toBe(shelfNameKey('istanbul'))
    expect(shelfNameKey('To read')).not.toBe(shelfNameKey('To reads'))
  })
})

describe('shelfFilter and shelfIdOf', () => {
  const id = '6f1c0000-0000-4000-8000-000000000000'

  it('round-trips a shelf id', () => {
    expect(shelfFilter(id)).toBe(`shelf-${id}`)
    expect(shelfIdOf(shelfFilter(id))).toBe(id)
  })

  it('accepts only shelf- followed by a UUID', () => {
    expect(shelfIdOf(id)).toBeNull()
    expect(shelfIdOf('shelf-')).toBeNull()
    expect(shelfIdOf('shelf-not-a-uuid')).toBeNull()
    expect(shelfIdOf(`shelf-${id}x`)).toBeNull()
    expect(shelfIdOf(`shelf-${id.toUpperCase()}`)).toBeNull()
    expect(shelfIdOf('audio')).toBeNull()
    expect(shelfIdOf('all')).toBeNull()
  })
})
