import { describe, expect, it } from 'vitest'
import { episodeKey } from '~/client/features/player/position-store'
import { positionKey } from '~/client/features/read-aloud/position-store'
import { DEFAULT_PREFS } from '~/client/features/reader/prefs'
import { ACCOUNT_KEY, readLocal, writeLocal } from '~/client/features/sync/local'

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

const entry = {
  bookSlug: 'emma',
  bookTitle: 'Emma',
  chapterTitle: 'Chapter 2',
  href: '/read/emma/chapter-2',
  at: 5,
  position: { chapter: 'chapter-2', page: 1 },
  label: 'Ch. 2 · p. 1',
}
const synced = { theme: 'sepia', font: 'opendyslexic', leading: 'relaxed', measure: 'wide' } as const

describe('readLocal', () => {
  it('reads every kind from this browser’s keys', () => {
    const storage = memoryStorage({
      [ACCOUNT_KEY]: 'ada',
      'recent-reading': JSON.stringify([entry]),
      [episodeKey('the-prophet', 'ep_1')]: '{"v":1,"ms":15000,"at":7}',
      [positionKey('emma')]: '{"v":1,"chapter":1,"position":{"chapter":"chapter-2","page":1},"offset":9,"at":8}',
      [positionKey('persuasion')]: '{"v":1,"done":true,"at":3}',
      'reader-prefs': JSON.stringify({ ...DEFAULT_PREFS, ...synced, fontSize: 23 }),
      'reader-prefs-at': '42',
    })
    const local = readLocal(storage, false)
    expect(local.account).toBe('ada')
    expect(local.reading).toEqual([entry])
    expect(local.listening).toEqual(
      expect.arrayContaining([
        { kind: 'episode', book: 'the-prophet', episode: 'ep_1', ms: 15_000, at: 7 },
        {
          kind: 'voice',
          book: 'emma',
          saved: { v: 1, chapter: 1, position: { chapter: 'chapter-2', page: 1 }, offset: 9, at: 8 },
          at: 8,
        },
        { kind: 'voice', book: 'persuasion', saved: null, at: 3 },
      ]),
    )
    expect(local.listening).toHaveLength(3)
    expect(local.settings).toEqual({ values: synced, at: 42 })
  })

  it('has no settings when no prefs were ever saved, and at 0 for prefs saved before sync', () => {
    expect(readLocal(memoryStorage(), true).settings).toBeNull()
    const old = memoryStorage({ 'reader-prefs': JSON.stringify(DEFAULT_PREFS) })
    expect(readLocal(old, false).settings).toEqual({
      values: { theme: 'light', font: 'literata', leading: 'normal', measure: 'normal' },
      at: 0,
    })
  })

  it('reads a blocked store as empty', () => {
    expect(readLocal(blocked, false)).toEqual({ account: null, reading: [], listening: [], settings: null })
    expect(readLocal(null, false)).toEqual({ account: null, reading: [], listening: [], settings: null })
  })
})

describe('writeLocal', () => {
  it('writes reading places, listening of both kinds and the account', () => {
    const storage = memoryStorage()
    writeLocal(
      storage,
      {
        account: 'ada',
        reading: [entry],
        listening: {
          replace: false,
          items: [
            { book: 'the-prophet', kind: 'episode', episode: 'ep_1', positionMs: 15_000, at: 7, device: 'x' },
            { book: 'the-prophet', kind: 'episode', episode: 'ep_2', positionMs: null, at: 8, device: 'x' },
            {
              book: 'emma',
              kind: 'voice',
              chapter: 1,
              position: { chapter: 'chapter-2', page: 1 },
              offset: 9,
              at: 8,
              device: 'x',
            },
            { book: 'persuasion', kind: 'voice', chapter: 0, position: null, offset: 0, at: 3, device: 'x' },
          ],
        },
      },
      false,
    )
    const local = readLocal(storage, false)
    expect(local.account).toBe('ada')
    expect(local.reading).toEqual([entry])
    expect(local.listening).toEqual(
      expect.arrayContaining([
        { kind: 'episode', book: 'the-prophet', episode: 'ep_1', ms: 15_000, at: 7 },
        { kind: 'episode', book: 'the-prophet', episode: 'ep_2', ms: null, at: 8 },
        expect.objectContaining({ kind: 'voice', book: 'emma', at: 8 }),
        { kind: 'voice', book: 'persuasion', saved: null, at: 3 },
      ]),
    )
  })

  it('forgets this browser’s listening positions when replacing them', () => {
    const storage = memoryStorage({
      [episodeKey('the-prophet', 'ep_9')]: '{"v":1,"ms":1,"at":1}',
      [positionKey('emma')]: '{"v":1,"done":true,"at":3}',
      'player-pos:https://a/b.mp3': '5000',
      'read-aloud-speed': '1.5',
    })
    writeLocal(
      storage,
      {
        listening: {
          replace: true,
          items: [{ book: 'the-prophet', kind: 'episode', episode: 'ep_1', positionMs: 2, at: 2, device: 'x' }],
        },
      },
      false,
    )
    expect(readLocal(storage, false).listening).toEqual([
      { kind: 'episode', book: 'the-prophet', episode: 'ep_1', ms: 2, at: 2 },
    ])
    expect(storage.getItem('player-pos:https://a/b.mp3')).toBeNull()
    expect(storage.getItem('read-aloud-speed')).toBe('1.5')
  })

  it('writes the settings into the stored prefs, keeping this device’s font size, mode and panel', () => {
    const own = { ...DEFAULT_PREFS, fontSize: 15, layout: 'scroll', sidebarHidden: true, askOpen: true }
    const storage = memoryStorage({ 'reader-prefs': JSON.stringify(own) })
    writeLocal(storage, { settings: { values: synced, at: 99 } }, false)
    expect(JSON.parse(storage.getItem('reader-prefs') ?? '{}')).toEqual({ ...own, ...synced })
    expect(storage.getItem('reader-prefs-at')).toBe('99')

    const fresh = memoryStorage()
    writeLocal(fresh, { settings: { values: synced, at: 1 } }, true)
    expect(JSON.parse(fresh.getItem('reader-prefs') ?? '{}')).toEqual({ ...DEFAULT_PREFS, ...synced })
  })

  it('writes nothing to a blocked store, and doesn’t throw', () => {
    expect(() =>
      writeLocal(
        blocked,
        {
          account: 'ada',
          reading: [entry],
          listening: { replace: true, items: [] },
          settings: { values: synced, at: 1 },
        },
        false,
      ),
    ).not.toThrow()
  })
})
