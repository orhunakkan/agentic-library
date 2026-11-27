import { describe, expect, it } from 'vitest'
import { QUERY_MAX, queryOf, textForQuery } from '~/client/features/library/search-text'

describe('queryOf', () => {
  it('drops an empty box from the URL', () => {
    expect(queryOf('')).toBeUndefined()
  })

  it('keeps the text as typed, spaces and case included', () => {
    expect(queryOf('  AUSTEN ')).toBe('  AUSTEN ')
  })

  it('cuts the query at QUERY_MAX characters', () => {
    expect(queryOf('a'.repeat(QUERY_MAX + 5))).toBe('a'.repeat(QUERY_MAX))
  })
})

describe('textForQuery', () => {
  it('keeps what was typed while an older key press is still arriving', () => {
    expect(textForQuery('pri', 'p', 'pri')).toBe('pri')
    expect(textForQuery('pri', undefined, 'pri')).toBe('pri')
  })

  it('keeps the box when the URL caught up with it', () => {
    expect(textForQuery('pride', 'pride', 'pride')).toBe('pride')
  })

  it('follows a q that came from somewhere else: Back, Forward or a link', () => {
    expect(textForQuery('pride', 'austen', 'austen')).toBe('austen')
    expect(textForQuery('', 'austen', 'austen')).toBe('austen')
  })

  it('empties the box when q is gone, as after Clear filters', () => {
    expect(textForQuery('prophet', undefined, undefined)).toBe('')
  })

  it('keeps a box that only runs past the URL limit', () => {
    const long = 'a'.repeat(QUERY_MAX + 1)
    expect(textForQuery(long, 'a'.repeat(QUERY_MAX), 'a'.repeat(QUERY_MAX))).toBe(long)
  })
})
