import { describe, expect, it } from 'vitest'
import {
  clearPrivatePositions,
  dismissOffer,
  FOLIO_OFFER_KEY,
  finishPosition,
  forgetVoice,
  listPositions,
  offerDismissed,
  parsePosition,
  positionKey,
  readPosition,
  readSpeed,
  readStamp,
  readVoices,
  rememberedVoice,
  rememberVoice,
  SPEED_KEY,
  VOICE_KEY,
  voiceChoiceKey,
  voiceItem,
  writePosition,
  writeSpeed,
} from '~/client/features/read-aloud/position-store'
import { privateBookSlug } from '~/shared/content/book-slug'

const PRIVATE_5678 = privateBookSlug('56785678-0000-4000-8000-000000000000')

const PRIVATE_1234 = privateBookSlug('12341234-0000-4000-8000-000000000000')

function memoryStorage(entries: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(entries))
  return {
    get length() {
      return map.size
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  }
}

const blocked = new Proxy({} as Storage, {
  get() {
    throw new DOMException('blocked', 'SecurityError')
  },
})

describe('positions', () => {
  it('keeps one position per book: the chapter, the page and the sentence offset', () => {
    const storage = memoryStorage()
    writePosition(storage, 'pride-and-prejudice', {
      chapter: 2,
      position: { chapter: 'functions', page: 3 },
      offset: 120,
      at: 1700,
    })
    writePosition(storage, 'confessions', { chapter: 0, position: { printedPage: 8 }, offset: 0, at: 5 })
    expect(readPosition(storage, 'pride-and-prejudice')).toEqual({
      v: 1,
      chapter: 2,
      position: { chapter: 'functions', page: 3 },
      offset: 120,
      at: 1700,
    })
    expect(readPosition(storage, 'confessions')?.position).toEqual({ printedPage: 8 })
    expect(readPosition(storage, 'other')).toBeNull()
    expect(storage.getItem(positionKey('confessions'))).not.toContain('text')
  })

  it.each([
    ['nothing', null],
    ['not JSON', '{'],
    ['another version', '{"v":2,"chapter":0,"position":{"printedPage":1},"offset":0}'],
    ['a negative chapter', '{"v":1,"chapter":-1,"position":{"printedPage":1},"offset":0}'],
    ['a fractional offset', '{"v":1,"chapter":0,"position":{"printedPage":1},"offset":0.5}'],
    ['no position', '{"v":1,"chapter":0,"offset":0}'],
    ['page 0 of a chapter', '{"v":1,"chapter":0,"position":{"chapter":"a","page":0},"offset":0}'],
    ['an empty chapter slug', '{"v":1,"chapter":0,"position":{"chapter":"","page":1},"offset":0}'],
  ])('reads %s as no position', (_name, raw) => {
    expect(parsePosition(raw)).toBeNull()
  })

  it('forgets quietly when the store is blocked', () => {
    expect(readPosition(blocked, 'x')).toBeNull()
    expect(() =>
      writePosition(blocked, 'x', { chapter: 0, position: { printedPage: 1 }, offset: 0, at: 0 }),
    ).not.toThrow()
    expect(readPosition(null, 'x')).toBeNull()
    expect(() => finishPosition(blocked, 'x', 1)).not.toThrow()
    expect(readStamp(blocked, 'x')).toBeNull()
    expect(listPositions(blocked)).toEqual([])
    expect(listPositions(null)).toEqual([])
  })

  it('reads a position saved before positions had a time with at 0', () => {
    const storage = memoryStorage({
      [positionKey('emma')]: '{"v":1,"chapter":0,"position":{"printedPage":1},"offset":4}',
    })
    expect(readPosition(storage, 'emma')).toEqual({ v: 1, chapter: 0, position: { printedPage: 1 }, offset: 4, at: 0 })
    expect(readStamp(storage, 'emma')).toEqual({ at: 0, done: false })
  })

  it('keeps a finished book as finished, which reads as no position', () => {
    const storage = memoryStorage()
    writePosition(storage, 'emma', { chapter: 3, position: { chapter: 'c', page: 2 }, offset: 9, at: 10 })
    finishPosition(storage, 'emma', 20)
    expect(readPosition(storage, 'emma')).toBeNull()
    expect(readStamp(storage, 'emma')).toEqual({ at: 20, done: true })
    expect(readStamp(storage, 'other')).toBeNull()
  })

  it('lists every book’s position or finish for the sync layer, leaving out anything malformed', () => {
    const storage = memoryStorage({
      [positionKey('emma')]: '{"v":1,"chapter":0,"position":{"printedPage":1},"offset":4,"at":3}',
      [positionKey(privateBookSlug('11111111-1111-4111-8111-111111111111'))]: '{"v":1,"done":true,"at":9}',
      [positionKey('broken')]: '{',
      'read-aloud-speed': '1.5',
    })
    expect(listPositions(storage).sort((a, b) => a.book.localeCompare(b.book))).toEqual([
      { book: 'emma', saved: { v: 1, chapter: 0, position: { printedPage: 1 }, offset: 4, at: 3 }, at: 3 },
      { book: privateBookSlug('11111111-1111-4111-8111-111111111111'), saved: null, at: 9 },
    ])
  })

  it("clears only private books' positions on sign-out", () => {
    const storage = memoryStorage({
      [positionKey(PRIVATE_1234)]: '{}',
      [positionKey(PRIVATE_5678)]: '{}',
      [positionKey('pride-and-prejudice')]: '{}',
      [`ask:${PRIVATE_1234}`]: '{}',
    })
    clearPrivatePositions(storage)
    expect([...Array(storage.length)].map((_, i) => storage.key(i)).sort()).toEqual([
      `ask:${PRIVATE_1234}`,
      positionKey('pride-and-prejudice'),
    ])
    expect(() => clearPrivatePositions(blocked)).not.toThrow()
    expect(() => clearPrivatePositions(null)).not.toThrow()
  })
})

describe('speed', () => {
  it('remembers the speed apart from the audiobook speed, and takes only the player’s speeds', () => {
    const storage = memoryStorage({ 'player-speed': '2' })
    expect(readSpeed(storage)).toBe(1)
    writeSpeed(storage, 1.5)
    expect(storage.getItem(SPEED_KEY)).toBe('1.5')
    expect(readSpeed(storage)).toBe(1.5)
    storage.setItem(SPEED_KEY, '9')
    expect(readSpeed(storage)).toBe(1)
    expect(readSpeed(blocked)).toBe(1)
    expect(() => writeSpeed(blocked, 2)).not.toThrow()
  })
})

describe('voices', () => {
  it('remembers one voice per language', () => {
    const storage = memoryStorage()
    rememberVoice(storage, 'en', 'Google US English')
    rememberVoice(storage, 'tr', 'Yelda')
    rememberVoice(storage, 'en', 'Samantha')
    expect(readVoices(storage)).toEqual({ en: 'Samantha', tr: 'Yelda' })
  })

  it('reads anything malformed as no choices, keeping only string entries', () => {
    expect(readVoices(memoryStorage({ [VOICE_KEY]: '[1]' }))).toEqual({})
    expect(readVoices(memoryStorage({ [VOICE_KEY]: '{' }))).toEqual({})
    expect(readVoices(memoryStorage({ [VOICE_KEY]: '{"en":"A","tr":3}' }))).toEqual({ en: 'A' })
    expect(readVoices(blocked)).toEqual({})
    expect(() => rememberVoice(blocked, 'en', 'A')).not.toThrow()
  })
})

describe('voiceItem', () => {
  it('gives a saved position as the sync outbox takes it', () => {
    const saved = { chapter: 5, position: { chapter: 'chapter-6', page: 2 }, offset: 40, at: 9 }
    expect(voiceItem(memoryStorage(), 'emma', saved, 100)).toEqual({
      book: 'emma',
      kind: 'voice',
      position: { chapter: 'chapter-6', page: 2 },
      offset: 40,
      at: 9,
    })
  })

  it('gives a finished book with the time it was stored with, or now when there is none', () => {
    const storage = memoryStorage()
    finishPosition(storage, 'emma', 42)
    expect(voiceItem(storage, 'emma', null, 100)).toEqual({
      book: 'emma',
      kind: 'voice',
      position: null,
      offset: 0,
      at: 42,
    })
    expect(voiceItem(storage, 'other', null, 100)).toMatchObject({ position: null, at: 100 })
  })
})

describe('voice choices for catalogue and private books', () => {
  it('are kept apart, and an ElevenLabs voice for one kind is never used for the other', () => {
    const storage = memoryStorage({})
    expect(voiceChoiceKey('en', false)).toBe('en')
    expect(voiceChoiceKey('en', true)).toBe('en:private')
    rememberVoice(storage, 'en', 'elevenlabs:Aria01')
    expect(rememberedVoice(storage, 'en', false)).toBe('elevenlabs:Aria01')
    expect(rememberedVoice(storage, 'en', true)).toBeUndefined()
    rememberVoice(storage, 'en:private', 'elevenlabs:Ben02')
    expect(rememberedVoice(storage, 'en', true)).toBe('elevenlabs:Ben02')
    expect(rememberedVoice(storage, 'en', false)).toBe('elevenlabs:Aria01')
  })

  it('still read a device voice chosen before they were kept apart, for both kinds', () => {
    const storage = memoryStorage({ [VOICE_KEY]: JSON.stringify({ en: 'Samantha' }) })
    expect(rememberedVoice(storage, 'en', true)).toBe('Samantha')
    expect(rememberedVoice(storage, 'en', false)).toBe('Samantha')
    expect(rememberedVoice(storage, 'fr', true)).toBeUndefined()
  })

  it('forget a gone voice only while it is still the choice', () => {
    const storage = memoryStorage({ [VOICE_KEY]: JSON.stringify({ en: 'elevenlabs:Aria01', fr: 'Thomas' }) })
    forgetVoice(storage, 'en', 'elevenlabs:Ben02')
    expect(readVoices(storage)).toEqual({ en: 'elevenlabs:Aria01', fr: 'Thomas' })
    forgetVoice(storage, 'en', 'elevenlabs:Aria01')
    expect(readVoices(storage)).toEqual({ fr: 'Thomas' })
    const blocked = {
      getItem: () => null,
      setItem: () => {
        throw new Error('blocked')
      },
    } as unknown as Storage
    expect(() => forgetVoice(blocked, 'en', 'x')).not.toThrow()
    expect(() => forgetVoice(null, 'en', 'x')).not.toThrow()
  })
})

describe('the Folio voice’s offer', () => {
  it('is shown until Not now, which is kept', () => {
    const storage = memoryStorage()
    expect(offerDismissed(storage)).toBe(false)
    dismissOffer(storage)
    expect(storage.getItem(FOLIO_OFFER_KEY)).toBe('{"v":1,"dismissed":true}')
    expect(offerDismissed(storage)).toBe(true)
  })

  it('reads anything malformed, and a blocked store, as not dismissed', () => {
    const storage = memoryStorage()
    storage.setItem(FOLIO_OFFER_KEY, '{nope')
    expect(offerDismissed(storage)).toBe(false)
    storage.setItem(FOLIO_OFFER_KEY, '{"v":2,"dismissed":true}')
    expect(offerDismissed(storage)).toBe(false)
    expect(offerDismissed(null)).toBe(false)
    const blocked = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    } as unknown as Storage
    expect(offerDismissed(blocked)).toBe(false)
    expect(() => dismissOffer(blocked)).not.toThrow()
  })
})
