import { describe, expect, it } from 'vitest'
import { libraryPathFor } from './legacy-paths'

describe('libraryPathFor', () => {
  it('maps the old library, series and book paths onto /library', () => {
    expect(libraryPathFor('/works')).toBe('/library')
    expect(libraryPathFor('/works/')).toBe('/library/')
    expect(libraryPathFor('/works/jane-austen')).toBe('/library/jane-austen')
    expect(libraryPathFor('/works/jane-austen/pride-and-prejudice')).toBe('/library/jane-austen/pride-and-prejudice')
  })

  it('leaves other paths alone', () => {
    expect(libraryPathFor('/worksheet')).toBeNull()
    expect(libraryPathFor('/library')).toBeNull()
    expect(libraryPathFor('/read/works')).toBeNull()
  })
})
