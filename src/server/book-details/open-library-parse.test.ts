import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseSearch, parseWork } from './open-library-parse'

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../../tests/stubs/open-library/${name}.json`, import.meta.url), 'utf8'))

describe('parseSearch', () => {
  it('reads the saved title search into matches, in order', () => {
    const matches = parseSearch(fixture('search-title'))
    expect(matches).toHaveLength(5)
    expect(matches[0]).toEqual({
      work: 'OL66554W',
      title: 'Pride and Prejudice',
      author: 'Jane Austen',
      year: 1813,
      coverId: 14348537,
    })
    expect(matches[2]?.author).toBe('Seth Grahame-Smith')
  })

  it('reads the saved ISBN search', () => {
    expect(parseSearch(fixture('search-isbn'))).toEqual([
      { work: 'OL66554W', title: 'Pride and Prejudice', author: 'Jane Austen', year: 1813, coverId: 14348537 },
    ])
  })

  it('skips malformed entries and keeps at most five', () => {
    const good = { key: '/works/OL1W', title: 'A' }
    const docs = [
      null,
      { title: 'No key' },
      { key: '/books/OL1M', title: 'An edition' },
      { key: '/works/OL2W' },
      { key: '/works/OL3W', title: '  ' },
      { key: '/works/OL4W', title: 'Odd fields', author_name: 'not a list', first_publish_year: -3, cover_i: 1.5 },
      ...Array.from({ length: 6 }, () => good),
    ]
    const matches = parseSearch({ docs })
    expect(matches).toHaveLength(5)
    expect(matches[0]).toEqual({ work: 'OL4W', title: 'Odd fields', author: null, year: null, coverId: null })
    expect(parseSearch(null)).toEqual([])
    expect(parseSearch({ docs: 'none' })).toEqual([])
  })
})

describe('parseWork', () => {
  it('reads the saved work’s description as a string', () => {
    const { description } = parseWork(fixture('work-OL66554W'))
    expect(description).toMatch(/^Pride and Prejudice is an 1813 novel of manners/)
    expect(description).toContain('\n\nMr. Bennet')
  })

  it('reads a description given as { type, value }, cleaned', () => {
    expect(
      parseWork({ description: { type: '/type/text', value: 'See [the site](https://x.test).\r\n\r\nTwo.' } }),
    ).toEqual({
      description: 'See the site.\n\nTwo.',
    })
  })

  it('is null without one', () => {
    expect(parseWork({})).toEqual({ description: null })
    expect(parseWork({ description: 3 })).toEqual({ description: null })
    expect(parseWork('x')).toEqual({ description: null })
  })
})
