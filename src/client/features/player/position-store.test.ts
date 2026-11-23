import { describe, expect, it } from 'vitest'
import { privateBookSlug } from '~/shared/content/book-slug'
import {
  continueEpisode,
  episodeKey,
  finishEpisode,
  forgetPrivateEpisodes,
  legacyEpisodeKey,
  listEpisodes,
  readEpisode,
  readSpeed,
  SPEED_KEY,
  writeEpisode,
  writeSpeed,
} from './position-store'

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

describe('episode positions', () => {
  it('writes, reads and finishes an episode under its book and id', () => {
    const storage = memoryStorage()
    expect(readEpisode(storage, 'the-prophet', 'ep-1')).toEqual({ ms: null, at: 0 })
    writeEpisode(storage, 'the-prophet', 'ep-1', 12_345.6, 100)
    expect(storage.getItem(episodeKey('the-prophet', 'ep-1'))).toBe('{"v":1,"ms":12346,"at":100}')
    expect(readEpisode(storage, 'the-prophet', 'ep-1')).toEqual({ ms: 12_346, at: 100 })
    finishEpisode(storage, 'the-prophet', 'ep-1', 200)
    expect(readEpisode(storage, 'the-prophet', 'ep-1')).toEqual({ ms: null, at: 200 })
  })

  it('falls back to the old player-pos key, and drops it on the next save', () => {
    const url = 'https://audio.example/ep-1.mp3'
    const storage = memoryStorage({ [legacyEpisodeKey(url)]: '61000' })
    expect(readEpisode(storage, 'the-prophet', 'ep-1', url)).toEqual({ ms: 61_000, at: 0 })
    expect(readEpisode(storage, 'the-prophet', 'ep-1')).toEqual({ ms: null, at: 0 })
    writeEpisode(storage, 'the-prophet', 'ep-1', 62_000, 5, url)
    expect(storage.getItem(legacyEpisodeKey(url))).toBeNull()
    expect(readEpisode(storage, 'the-prophet', 'ep-1', url)).toEqual({ ms: 62_000, at: 5 })
    storage.setItem(legacyEpisodeKey('other'), 'nonsense')
    expect(readEpisode(storage, 'x', 'y', 'other')).toEqual({ ms: null, at: 0 })
    storage.setItem(legacyEpisodeKey('two'), '9')
    finishEpisode(storage, 'x', 'z', 3, 'two')
    expect(storage.getItem(legacyEpisodeKey('two'))).toBeNull()
  })

  it('reads anything malformed as nothing stored', () => {
    const storage = memoryStorage({
      [episodeKey('a', '1')]: '{',
      [episodeKey('a', '2')]: '{"v":2,"ms":1,"at":1}',
      [episodeKey('a', '3')]: '{"v":1,"ms":-1,"at":1}',
      [episodeKey('a', '4')]: '{"v":1,"ms":1}',
    })
    for (const id of ['1', '2', '3', '4']) expect(readEpisode(storage, 'a', id)).toEqual({ ms: null, at: 0 })
  })

  it('lists every episode, splitting at the first colon so an episode id may have one', () => {
    const storage = memoryStorage({
      [episodeKey('the-prophet', 'ep:1')]: '{"v":1,"ms":1000,"at":3}',
      [episodeKey('emma', 'two')]: '{"v":1,"done":true,"at":4}',
      [episodeKey('emma', 'bad')]: '{',
      'listen-pos:no-episode': '{"v":1,"ms":1,"at":1}',
      'listen-pos:trailing:': '{"v":1,"ms":1,"at":1}',
      [legacyEpisodeKey('https://a/b.mp3')]: '5000',
      [SPEED_KEY]: '1.5',
    })
    expect(listEpisodes(storage).sort((a, b) => a.book.localeCompare(b.book))).toEqual([
      { book: 'emma', episode: 'two', ms: null, at: 4 },
      { book: 'the-prophet', episode: 'ep:1', ms: 1000, at: 3 },
    ])
  })

  it('forgets quietly when the store is blocked', () => {
    expect(readEpisode(blocked, 'a', 'b', 'c')).toEqual({ ms: null, at: 0 })
    expect(() => writeEpisode(blocked, 'a', 'b', 1, 1)).not.toThrow()
    expect(() => finishEpisode(blocked, 'a', 'b', 1)).not.toThrow()
    expect(listEpisodes(blocked)).toEqual([])
    expect(listEpisodes(null)).toEqual([])
    expect(readSpeed(blocked)).toBeNull()
    expect(() => writeSpeed(blocked, 2)).not.toThrow()
  })
})

describe('speed', () => {
  it('remembers the audiobook speed', () => {
    const storage = memoryStorage()
    expect(readSpeed(storage)).toBeNull()
    writeSpeed(storage, 1.25)
    expect(readSpeed(storage)).toBe(1.25)
    storage.setItem(SPEED_KEY, '-1')
    expect(readSpeed(storage)).toBeNull()
  })
})

describe('continueEpisode', () => {
  const book = privateBookSlug('6f1c0000-0000-4000-8000-000000000000')
  const episodes = ['1', '2', '3']

  it('is the episode played last, or the one after the episode finished last', () => {
    const storage = memoryStorage()
    expect(continueEpisode(storage, book, episodes)).toBeNull()
    writeEpisode(storage, book, '1', 5000, 10)
    writeEpisode(storage, book, '2', 7000, 20)
    expect(continueEpisode(storage, book, episodes)).toBe('2')
    finishEpisode(storage, book, '2', 30)
    expect(continueEpisode(storage, book, episodes)).toBe('3')
    finishEpisode(storage, book, '3', 40)
    expect(continueEpisode(storage, book, episodes)).toBeNull()
    writeEpisode(storage, 'the-prophet', 'ep_1', 1, 50)
    writeEpisode(storage, book, '9', 1, 60)
    expect(continueEpisode(storage, book, episodes)).toBeNull()
    expect(continueEpisode(blocked, book, episodes)).toBeNull()
  })
})

describe('forgetPrivateEpisodes', () => {
  it('removes private books’ positions and keeps the catalogue’s', () => {
    const storage = memoryStorage()
    writeEpisode(storage, privateBookSlug('6f1c0000-0000-4000-8000-000000000000'), '1', 5000, 10)
    writeEpisode(storage, 'the-prophet', 'ep_1', 5000, 10)
    forgetPrivateEpisodes(storage)
    expect(listEpisodes(storage).map((e) => e.book)).toEqual(['the-prophet'])
    expect(() => forgetPrivateEpisodes(blocked)).not.toThrow()
  })
})
