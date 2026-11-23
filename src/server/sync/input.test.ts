import { describe, expect, it } from 'vitest'
import { privateBookSlug } from '~/shared/content/book-slug'
import { parseSyncBatch } from './input'

const NOW = 1_800_000_000_000
const reading = { book: 'pride-and-prejudice', position: { chapter: 'chapter-6', page: 2 }, at: 1000 }
const episode = { book: 'the-prophet', kind: 'episode', episode: 'ep_1', positionMs: 15_000, at: 1000 }
const voice = {
  book: privateBookSlug('0f9b8c7e-1d2a-4b3c-8d4e-5f6a7b8c9d0e'),
  kind: 'voice',
  position: { printedPage: 9 },
  offset: 40,
  at: 1,
}
const settings = { values: { theme: 'dark', font: 'geist', leading: 'compact', measure: 'narrow' }, at: 5 }

const parse = (value: unknown) => parseSyncBatch(value, NOW)

describe('parseSyncBatch', () => {
  it('accepts each kind', () => {
    expect(parse({ reading: [reading], listening: [episode, voice], settings })).toEqual({
      reading: [reading],
      listening: [episode, voice],
      settings,
    })
    expect(parse({ reading: [{ ...reading, position: { printedPage: 112 } }] })).toEqual({
      reading: [{ ...reading, position: { printedPage: 112 } }],
    })
    expect(
      parse({
        listening: [
          { ...episode, positionMs: null },
          { ...voice, position: null, offset: 0 },
        ],
      }),
    ).toEqual({
      listening: [
        { ...episode, positionMs: null },
        { ...voice, position: null, offset: 0 },
      ],
    })
    expect(parse({ reading: [] })).toEqual({ reading: [] })
  })

  it('refuses an empty batch, an unknown field and anything that isn’t a batch', () => {
    expect(parse({})).toBeNull()
    expect(parse({ reading: [reading], extra: 1 })).toBeNull()
    expect(parse(null)).toBeNull()
    expect(parse([reading])).toBeNull()
    expect(parse({ reading: reading })).toBeNull()
  })

  it('refuses a list over 20 items', () => {
    const many = Array.from({ length: 21 }, (_, i) => ({ ...reading, book: `book-${i}` }))
    expect(parse({ reading: many })).toBeNull()
    expect(parse({ reading: many.slice(0, 20) })?.reading).toHaveLength(20)
    expect(parse({ listening: Array.from({ length: 21 }, () => episode) })).toBeNull()
  })

  it.each([
    ['an unknown field', { reading: [{ ...reading, title: 'Pride' }] }],
    ['a missing field', { reading: [{ book: reading.book, position: reading.position }] }],
    ['a bad slug', { reading: [{ ...reading, book: 'Not A Slug' }] }],
    ['a u- slug that isn’t a UUID', { reading: [{ ...reading, book: 'u-123' }] }],
    ['a bad position', { reading: [{ ...reading, position: { chapter: 'chapter-6', page: 0 } }] }],
    ['a negative at', { reading: [{ ...reading, at: -1 }] }],
    ['a fractional at', { reading: [{ ...reading, at: 1.5 }] }],
    ['a string at', { listening: [{ ...episode, at: '1' }] }],
    ['an unknown kind', { listening: [{ ...episode, kind: 'radio' }] }],
    ['fields from the voice kind on an episode', { listening: [{ ...episode, offset: 0 }] }],
    ['fields from the episode kind on a voice', { listening: [{ ...voice, episode: 'ep_1' }] }],
    ['an empty episode', { listening: [{ ...episode, episode: '' }] }],
    ['a long episode id', { listening: [{ ...episode, episode: 'e'.repeat(201) }] }],
    ['a positionMs out of range', { listening: [{ ...episode, positionMs: 86_400_001 }] }],
    ['a negative positionMs', { listening: [{ ...episode, positionMs: -1 }] }],
    ['an offset out of range', { listening: [{ ...voice, offset: 1_000_001 }] }],
    ['a fractional offset', { listening: [{ ...voice, offset: 0.5 }] }],
    ['an offset at the end of the book', { listening: [{ ...voice, position: null, offset: 3 }] }],
    ['a bad voice position', { listening: [{ ...voice, position: { printedPage: 'x' } }] }],
    ['a listening item that isn’t an object', { listening: ['x'] }],
    ['bad settings', { settings: { ...settings, values: { ...settings.values, theme: 'neon' } } }],
    ['settings with an extra field', { settings: { ...settings, device: 'x' } }],
    ['settings without at', { settings: { values: settings.values } }],
  ])('refuses %s', (_name, body) => {
    expect(parse(body)).toBeNull()
  })

  it('clamps a future at to the server’s clock', () => {
    expect(parse({ reading: [{ ...reading, at: NOW + 60_000 }] })?.reading?.[0]?.at).toBe(NOW)
    expect(parse({ listening: [{ ...episode, at: NOW + 1 }] })?.listening?.[0]?.at).toBe(NOW)
    expect(parse({ settings: { ...settings, at: NOW * 2 } })?.settings?.at).toBe(NOW)
  })

  it('keeps the newer of two items for the same thing, the later on a tie', () => {
    const older = { ...reading, position: { chapter: 'chapter-1', page: 1 }, at: 1 }
    const newer = { ...reading, position: { chapter: 'chapter-9', page: 1 }, at: 9 }
    expect(parse({ reading: [newer, older] })?.reading).toEqual([newer])
    expect(parse({ reading: [older, newer] })?.reading).toEqual([newer])
    const tie = { ...newer, position: { chapter: 'chapter-3', page: 1 } }
    expect(parse({ reading: [newer, tie] })?.reading).toEqual([tie])
    const two = { ...episode, episode: 'ep_2' }
    const sameBookVoice = { ...voice, book: 'the-prophet' }
    expect(parse({ listening: [episode, two, sameBookVoice] })?.listening).toHaveLength(3)
  })

  describe('time', () => {
    const time = {
      id: '0f9b8c7e-1d2a-4b3c-8d4e-5f6a7b8c9d0e',
      kind: 'reading',
      day: '2026-11-21',
      seconds: 90,
      at: 1000,
    }

    it('accepts a batch of time alone, with the zone or without it', () => {
      expect(parse({ time: [time], zone: 'Europe/Istanbul' })).toEqual({ time: [time], zone: 'Europe/Istanbul' })
      expect(parse({ time: [{ ...time, kind: 'listening', seconds: 14_400 }] })).toEqual({
        time: [{ ...time, kind: 'listening', seconds: 14_400 }],
      })
      expect(parse({ time: [{ ...time, id: time.id.toUpperCase() }] })?.time?.[0]?.id).toBe(time.id)
    })

    it('refuses each field in turn', () => {
      const refused = [
        { ...time, id: 'not-a-uuid' },
        { ...time, id: 7 },
        { ...time, kind: 'watching' },
        { ...time, day: '2026-02-30' },
        { ...time, day: '2026-1-5' },
        { ...time, seconds: 0 },
        { ...time, seconds: 14_401 },
        { ...time, seconds: 1.5 },
        { ...time, at: -1 },
        { ...time, book: 'pride-and-prejudice' },
        { id: time.id, kind: time.kind, day: time.day, at: time.at },
      ]
      for (const item of refused) expect(parse({ time: [item] })).toBeNull()
      expect(parse({ time: Array.from({ length: 21 }, () => time) })).toBeNull()
    })

    it('refuses a zone without time, and a zone Intl doesn’t know', () => {
      expect(parse({ reading: [reading], zone: 'UTC' })).toBeNull()
      expect(parse({ zone: 'UTC' })).toBeNull()
      expect(parse({ time: [time], zone: 'Mars/Olympus' })).toBeNull()
      expect(parse({ time: [time], zone: '../etc' })).toBeNull()
    })

    it('keeps the newest of a session sent twice', () => {
      const later = { ...time, seconds: 120, at: 2000 }
      expect(parse({ time: [later, time] })?.time).toEqual([later])
    })
  })
})
