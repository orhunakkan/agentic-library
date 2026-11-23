import { describe, expect, it } from 'vitest'
import { privateBookSlug } from '~/shared/content/book-slug'
import { decodeSummary, encodeSummary, type OfflineSummary } from './summary'

const summary: OfflineSummary = {
  slug: 'pride-and-prejudice',
  title: 'Pride and Prejudice',
  author: 'Jane Austen',
  owner: null,
  bytes: 2_400_000,
  savedAt: 1_794_000_000_000,
  start: '/read/pride-and-prejudice/chapter-1',
}

describe('encodeSummary and decodeSummary', () => {
  it('round-trip a summary as a header-safe value', () => {
    const value = encodeSummary(summary)
    expect(value).toMatch(/^[\x21-\x7e]+$/)
    expect(decodeSummary(value)).toEqual(summary)
  })

  it('keep non-ASCII titles and a private book’s owner', () => {
    const own = {
      ...summary,
      slug: privateBookSlug('0f8fad5b-d9cb-469f-a165-70867728950e'),
      title: 'Şiirler — “Gül”',
      author: 'Ünal',
      owner: 'ada',
      start: `/read/${privateBookSlug('0f8fad5b-d9cb-469f-a165-70867728950e')}/one`,
    }
    expect(decodeSummary(encodeSummary(own))).toEqual(own)
  })

  it('leave out any extra field', () => {
    const value = encodeSummary({ ...summary, extra: 1 } as OfflineSummary)
    expect(decodeSummary(value)).toEqual(summary)
  })

  it('give null for a missing or malformed value', () => {
    expect(decodeSummary(null)).toBeNull()
    expect(decodeSummary('')).toBeNull()
    expect(decodeSummary('%E0%A4%A')).toBeNull()
    expect(decodeSummary('not json')).toBeNull()
    expect(decodeSummary(encodeURIComponent('7'))).toBeNull()
    const bad = (patch: object) => encodeURIComponent(JSON.stringify({ ...summary, ...patch }))
    expect(decodeSummary(bad({ slug: 'u-nope' }))).toBeNull()
    expect(decodeSummary(bad({ owner: 'ada' }))).toBeNull()
    expect(decodeSummary(bad({ slug: privateBookSlug('0f8fad5b-d9cb-469f-a165-70867728950e') }))).toBeNull()
    expect(decodeSummary(bad({ bytes: -1 }))).toBeNull()
    expect(decodeSummary(bad({ savedAt: 'today' }))).toBeNull()
    expect(decodeSummary(bad({ title: null }))).toBeNull()
    expect(decodeSummary(bad({ start: 'https://elsewhere.test/read/pride-and-prejudice/x' }))).toBeNull()
    expect(decodeSummary(bad({ start: '/read/walden/x' }))).toBeNull()
    expect(decodeSummary(bad({ start: '/read/pride-and-prejudice-2/x' }))).toBeNull()
  })
})
