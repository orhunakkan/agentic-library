import { describe, expect, it } from 'vitest'
import { privateBookSlug } from '~/shared/content/book-slug'
import { parseAudioBookmarkChange, parseAudioBookmarkCreate } from './audio-input.ts'

const BOOK_ID = '6f1c2a4e-0000-4000-8000-000000000000'
const VOICE = { book: 'pride-and-prejudice', kind: 'voice', position: { chapter: 'chapter-6', page: 2 }, offset: 120 }
const EPISODE = { book: 'the-prophet', kind: 'episode', episode: 'ep_1', positionMs: 15_000 }

describe('parseAudioBookmarkCreate', () => {
  it('accepts a read-aloud moment on a chapter page, a printed page and a private book', () => {
    expect(parseAudioBookmarkCreate(VOICE)).toEqual(VOICE)
    expect(
      parseAudioBookmarkCreate({ ...VOICE, book: 'confessions-of-al-ghazzali', position: { printedPage: 39 } }),
    ).toEqual({ book: 'confessions-of-al-ghazzali', kind: 'voice', position: { printedPage: 39 }, offset: 120 })
    expect(parseAudioBookmarkCreate({ ...VOICE, book: privateBookSlug(BOOK_ID), offset: 0 })).toMatchObject({
      book: privateBookSlug(BOOK_ID),
      offset: 0,
    })
  })

  it('accepts an audiobook moment', () => {
    expect(parseAudioBookmarkCreate(EPISODE)).toEqual(EPISODE)
    expect(parseAudioBookmarkCreate({ ...EPISODE, positionMs: 0 })).toMatchObject({ positionMs: 0 })
    expect(parseAudioBookmarkCreate({ ...EPISODE, positionMs: 86_400_000 })).toMatchObject({ positionMs: 86_400_000 })
  })

  it('refuses an unknown kind, the other kind’s fields and an unknown field', () => {
    expect(parseAudioBookmarkCreate({ ...VOICE, kind: 'chapter' })).toBeNull()
    expect(parseAudioBookmarkCreate({ book: VOICE.book, position: VOICE.position, offset: 1 })).toBeNull()
    expect(parseAudioBookmarkCreate({ ...VOICE, episode: 'ep_1' })).toBeNull()
    expect(parseAudioBookmarkCreate({ ...VOICE, positionMs: 5 })).toBeNull()
    expect(parseAudioBookmarkCreate({ ...EPISODE, offset: 5 })).toBeNull()
    expect(parseAudioBookmarkCreate({ ...EPISODE, position: VOICE.position })).toBeNull()
    expect(parseAudioBookmarkCreate({ ...VOICE, text: 'It is a truth' })).toBeNull()
    expect(parseAudioBookmarkCreate({ ...EPISODE, title: 'The Coming of the Ship' })).toBeNull()
  })

  it('refuses a bad slug, a bad position and missing fields', () => {
    expect(parseAudioBookmarkCreate({ ...VOICE, book: 'Not A Slug' })).toBeNull()
    expect(parseAudioBookmarkCreate({ ...EPISODE, book: '../etc' })).toBeNull()
    expect(parseAudioBookmarkCreate({ ...VOICE, position: { chapter: 'chapter-6', page: 0 } })).toBeNull()
    expect(parseAudioBookmarkCreate({ ...VOICE, position: { printedPage: 1.5 } })).toBeNull()
    expect(parseAudioBookmarkCreate({ book: VOICE.book, kind: 'voice', offset: 1 })).toBeNull()
    expect(parseAudioBookmarkCreate({ book: EPISODE.book, kind: 'episode', episode: 'ep_1' })).toBeNull()
  })

  it('refuses an offset or a time that isn’t a whole number in range, and an empty or long episode', () => {
    for (const offset of [-1, 1.5, 100_001, '12', null, Number.NaN])
      expect(parseAudioBookmarkCreate({ ...VOICE, offset }), String(offset)).toBeNull()
    expect(parseAudioBookmarkCreate({ ...VOICE, offset: 100_000 })).toMatchObject({ offset: 100_000 })
    for (const positionMs of [-1, 0.5, 86_400_001, '15000', null])
      expect(parseAudioBookmarkCreate({ ...EPISODE, positionMs }), String(positionMs)).toBeNull()
    expect(parseAudioBookmarkCreate({ ...EPISODE, episode: '' })).toBeNull()
    expect(parseAudioBookmarkCreate({ ...EPISODE, episode: 'e'.repeat(201) })).toBeNull()
    expect(parseAudioBookmarkCreate({ ...EPISODE, episode: 7 })).toBeNull()
  })

  it('refuses anything that isn’t an object', () => {
    expect(parseAudioBookmarkCreate(null)).toBeNull()
    expect(parseAudioBookmarkCreate([VOICE])).toBeNull()
    expect(parseAudioBookmarkCreate('the-prophet')).toBeNull()
  })
})

describe('parseAudioBookmarkChange', () => {
  it('takes only { intent: "delete" }', () => {
    expect(parseAudioBookmarkChange({ intent: 'delete' })).toEqual({ intent: 'delete' })
    expect(parseAudioBookmarkChange({ intent: 'update' })).toBeNull()
    expect(parseAudioBookmarkChange({ intent: 'delete', id: 'x' })).toBeNull()
    expect(parseAudioBookmarkChange({})).toBeNull()
    expect(parseAudioBookmarkChange(null)).toBeNull()
  })
})
