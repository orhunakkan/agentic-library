import { describe, expect, it } from 'vitest'
import type { RecentReading } from '~/client/features/reader/continue-reading'
import { privateBookSlug } from '~/shared/content/book-slug'
import type { ListeningPlace, ReadingPlace, SettingsPlace, SyncState } from '~/shared/sync/sync'
import type { LocalListening, LocalState } from './local'
import { merge, toEntry } from './merge'

type Ready = Extract<SyncState, { state: 'ready' }>

const remoteRead = (book: string, at: number, chapter = 'chapter-8'): ReadingPlace => ({
  book,
  bookTitle: book.toUpperCase(),
  chapterTitle: chapter,
  href: `/read/${book}/${chapter}/3`,
  label: 'Ch. 8 · p. 3',
  position: { chapter, page: 3 },
  at,
  device: 'Safari on iPhone',
})
const localRead = (book: string, at: number, chapter = 'chapter-2'): RecentReading => ({
  bookSlug: book,
  bookTitle: book.toUpperCase(),
  chapterTitle: chapter,
  href: `/read/${book}/${chapter}`,
  at,
  position: { chapter, page: 1 },
  label: 'Ch. 2 · p. 1',
})
const localEpisode = (at: number, ms: number | null = 5000): LocalListening => ({
  kind: 'episode',
  book: 'the-prophet',
  episode: 'ep_1',
  ms,
  at,
})
const remoteEpisode = (at: number, positionMs: number | null = 9000): ListeningPlace => ({
  book: 'the-prophet',
  kind: 'episode',
  episode: 'ep_1',
  positionMs,
  at,
  device: 'x',
})
const localVoice = (at: number, offset: number | null = 4): LocalListening => ({
  kind: 'voice',
  book: 'emma',
  saved: offset === null ? null : { v: 1, chapter: 2, position: { chapter: 'chapter-3', page: 1 }, offset, at },
  at,
})
const remoteVoice = (at: number, offset: number | null = 40): ListeningPlace => ({
  book: 'emma',
  kind: 'voice',
  chapter: offset === null ? 0 : 7,
  position: offset === null ? null : { chapter: 'chapter-8', page: 2 },
  offset: offset ?? 0,
  at,
  device: 'x',
})
const values = (theme: 'light' | 'sepia' | 'dark') =>
  ({ theme, font: 'geist', leading: 'normal', measure: 'wide' }) as const
const remoteSettings = (at: number, theme: 'light' | 'sepia' | 'dark' = 'dark'): SettingsPlace => ({
  values: values(theme),
  at,
  device: 'x',
})

const local = (over: Partial<LocalState> = {}): LocalState => ({
  account: 'ada',
  reading: [],
  listening: [],
  settings: null,
  ...over,
})
const remote = (over: Partial<Omit<Ready, 'state'>> = {}): Ready => ({
  state: 'ready',
  reading: [],
  listening: [],
  settings: null,
  ...over,
})

describe('merge: reading places', () => {
  it('writes the account’s place when it is newer', () => {
    const result = merge(
      local({ reading: [localRead('emma', 1)] }),
      remote({ reading: [remoteRead('emma', 2)] }),
      'ada',
    )
    expect(result.write.reading).toEqual([toEntry(remoteRead('emma', 2))])
    expect(result.push).toEqual({})
    expect(result.changed).toEqual(['reading'])
  })

  it('pushes the browser’s place when it is newer, keeping its at', () => {
    const result = merge(
      local({ reading: [localRead('emma', 3)] }),
      remote({ reading: [remoteRead('emma', 2)] }),
      'ada',
    )
    expect(result.write.reading).toBeUndefined()
    expect(result.push).toEqual({ reading: [{ book: 'emma', position: { chapter: 'chapter-2', page: 1 }, at: 3 }] })
    expect(result.changed).toEqual([])
  })

  it('keeps the account’s on a tie, and writes nothing when they already agree', () => {
    const tie = merge(local({ reading: [localRead('emma', 2)] }), remote({ reading: [remoteRead('emma', 2)] }), 'ada')
    expect(tie.write.reading).toEqual([toEntry(remoteRead('emma', 2))])
    expect(tie.push).toEqual({})
    const same = merge(
      local({ reading: [toEntry(remoteRead('emma', 2))] }),
      remote({ reading: [remoteRead('emma', 2)] }),
      'ada',
    )
    expect(same.write).toEqual({})
    expect(same.changed).toEqual([])
  })

  it('takes a place only the account has, and pushes one only the browser has', () => {
    const result = merge(
      local({ reading: [localRead('emma', 5)] }),
      remote({ reading: [remoteRead('persuasion', 9)] }),
      'ada',
    )
    expect(result.write.reading?.map((e) => e.bookSlug)).toEqual(['emma', 'persuasion'])
    expect(result.push.reading?.map((r) => r.book)).toEqual(['emma'])
  })

  it('pushes an entry from before sync through its address, and never one whose address names no page', () => {
    const { position: _, ...old } = localRead('emma', 5)
    const odd = { ...localRead('persuasion', 6), position: undefined, href: '/library' }
    const result = merge(local({ reading: [old, odd] }), remote(), 'ada')
    expect(result.push.reading).toEqual([{ book: 'emma', position: { chapter: 'chapter-2', page: 1 }, at: 5 }])
  })

  it('reads a page of digits from before sync as a chapter only in a private book, whose kind is known', () => {
    const PRIVATE = privateBookSlug('12341234-0000-4000-8000-000000000000')
    const { position: _, ...catalogue } = { ...localRead('essays', 5), href: '/read/essays/12' }
    const { position: __, ...mine } = { ...localRead(PRIVATE, 6), href: `/read/${PRIVATE}/12` }
    const result = merge(local({ reading: [catalogue, mine] }), remote(), 'ada')
    expect(result.push.reading).toEqual([{ book: PRIVATE, position: { chapter: '12', page: 1 }, at: 6 }])
  })

  it('pushes a place missing from a full answer only when it is newer than the oldest listed', () => {
    const full = Array.from({ length: 50 }, (_, i) => remoteRead(`book-${i}`, 100 + i))
    const result = merge(
      local({ reading: [localRead('old', 50), localRead('new', 120)] }),
      remote({ reading: full }),
      'ada',
    )
    expect(result.push.reading?.map((r) => r.book)).toEqual(['new'])
  })
})

describe('merge: listening', () => {
  it('writes the account’s episode when newer, pushes the browser’s when newer, and keeps the account’s on a tie', () => {
    const older = merge(local({ listening: [localEpisode(1)] }), remote({ listening: [remoteEpisode(2)] }), 'ada')
    expect(older.write.listening).toEqual({ replace: false, items: [remoteEpisode(2)] })
    expect(older.changed).toEqual(['listening'])
    const newer = merge(local({ listening: [localEpisode(3)] }), remote({ listening: [remoteEpisode(2)] }), 'ada')
    expect(newer.push.listening).toEqual([
      { book: 'the-prophet', kind: 'episode', episode: 'ep_1', positionMs: 5000, at: 3 },
    ])
    expect(newer.write.listening).toBeUndefined()
    const tie = merge(local({ listening: [localEpisode(2)] }), remote({ listening: [remoteEpisode(2)] }), 'ada')
    expect(tie.write.listening?.items).toEqual([remoteEpisode(2)])
    expect(tie.push).toEqual({})
    const agree = merge(local({ listening: [localEpisode(2, 9000)] }), remote({ listening: [remoteEpisode(2)] }), 'ada')
    expect(agree.write).toEqual({})
  })

  it('does the same for read-aloud positions', () => {
    const older = merge(local({ listening: [localVoice(1)] }), remote({ listening: [remoteVoice(2)] }), 'ada')
    expect(older.write.listening?.items).toEqual([remoteVoice(2)])
    const newer = merge(local({ listening: [localVoice(3)] }), remote({ listening: [remoteVoice(2)] }), 'ada')
    expect(newer.push.listening).toEqual([
      { book: 'emma', kind: 'voice', position: { chapter: 'chapter-3', page: 1 }, offset: 4, at: 3 },
    ])
    const tie = merge(local({ listening: [localVoice(2)] }), remote({ listening: [remoteVoice(2)] }), 'ada')
    expect(tie.write.listening?.items).toEqual([remoteVoice(2)])
    const agree = merge(
      local({
        listening: [
          {
            kind: 'voice',
            book: 'emma',
            saved: { v: 1, chapter: 7, position: { chapter: 'chapter-8', page: 2 }, offset: 40, at: 2 },
            at: 2,
          },
        ],
      }),
      remote({ listening: [remoteVoice(2)] }),
      'ada',
    )
    expect(agree.write).toEqual({})
  })

  it('takes items only the account has and pushes items only the browser has', () => {
    const result = merge(local({ listening: [localVoice(5)] }), remote({ listening: [remoteEpisode(9)] }), 'ada')
    expect(result.write.listening?.items).toEqual([remoteEpisode(9)])
    expect(result.push.listening?.map((l) => l.kind)).toEqual(['voice'])
  })

  it('carries finished items both ways', () => {
    const theirs = merge(
      local({ listening: [localEpisode(1), localVoice(1)] }),
      remote({ listening: [remoteEpisode(2, null), remoteVoice(2, null)] }),
      'ada',
    )
    expect(theirs.write.listening?.items).toEqual([remoteEpisode(2, null), remoteVoice(2, null)])
    const mine = merge(
      local({ listening: [localEpisode(3, null), localVoice(3, null)] }),
      remote({ listening: [remoteEpisode(2), remoteVoice(2)] }),
      'ada',
    )
    expect(mine.push.listening).toEqual([
      { book: 'the-prophet', kind: 'episode', episode: 'ep_1', positionMs: null, at: 3 },
      { book: 'emma', kind: 'voice', position: null, offset: 0, at: 3 },
    ])
    const bothDone = merge(
      local({ listening: [localVoice(2, null)] }),
      remote({ listening: [remoteVoice(2, null)] }),
      'ada',
    )
    expect(bothDone.write).toEqual({})
    const oneDone = merge(local({ listening: [localVoice(2, null)] }), remote({ listening: [remoteVoice(2)] }), 'ada')
    expect(oneDone.write.listening?.items).toEqual([remoteVoice(2)])
  })

  it('pushes an item missing from a full answer only when it is newer than the oldest listed', () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ ...remoteEpisode(100 + i), episode: `ep_${i + 10}` }))
    const result = merge(
      local({ listening: [localEpisode(50), { ...localEpisode(150), episode: 'ep_new' } as LocalListening] }),
      remote({ listening: full }),
      'ada',
    )
    expect(result.push.listening?.map((l) => (l.kind === 'episode' ? l.episode : ''))).toEqual(['ep_new'])
  })
})

describe('merge: settings', () => {
  it('writes the account’s when newer or when the browser has none, and pushes the browser’s when newer or alone', () => {
    const mine = { values: values('sepia'), at: 5 }
    expect(merge(local({ settings: mine }), remote({ settings: remoteSettings(6) }), 'ada').write.settings).toEqual({
      values: values('dark'),
      at: 6,
    })
    expect(merge(local(), remote({ settings: remoteSettings(6) }), 'ada').changed).toEqual(['settings'])
    expect(merge(local({ settings: mine }), remote({ settings: remoteSettings(4) }), 'ada').push.settings).toEqual(mine)
    expect(merge(local({ settings: mine }), remote(), 'ada').push.settings).toEqual(mine)
    expect(merge(local(), remote(), 'ada')).toEqual({ write: {}, push: {}, replaced: false, changed: [] })
  })

  it('keeps the account’s on a tie', () => {
    const tie = merge(
      local({ settings: { values: values('sepia'), at: 6 } }),
      remote({ settings: remoteSettings(6) }),
      'ada',
    )
    expect(tie.write.settings).toEqual({ values: values('dark'), at: 6 })
    expect(tie.push).toEqual({})
    const agree = merge(
      local({ settings: { values: values('dark'), at: 6 } }),
      remote({ settings: remoteSettings(6) }),
      'ada',
    )
    expect(agree.write).toEqual({})
  })
})

describe('merge: whose browser it is', () => {
  it('merges a browser’s history from before its first sign-in, and remembers the account', () => {
    const result = merge(local({ account: null, reading: [localRead('emma', 5)] }), remote(), 'ada')
    expect(result.write.account).toBe('ada')
    expect(result.push.reading).toHaveLength(1)
    expect(result.replaced).toBe(false)
  })

  it('replaces another account’s copy with this account’s, and pushes nothing', () => {
    const result = merge(
      local({
        account: 'bea',
        reading: [localRead('emma', 50)],
        listening: [localEpisode(50)],
        settings: { values: values('sepia'), at: 50 },
      }),
      remote({ reading: [remoteRead('persuasion', 1)], listening: [remoteVoice(1)], settings: remoteSettings(1) }),
      'ada',
    )
    expect(result).toEqual({
      write: {
        account: 'ada',
        reading: [toEntry(remoteRead('persuasion', 1))],
        listening: { replace: true, items: [remoteVoice(1)] },
        settings: { values: values('dark'), at: 1 },
      },
      push: {},
      replaced: true,
      changed: ['reading', 'listening', 'settings'],
    })
  })

  it('keeps the browser’s own settings when the new account has none', () => {
    const result = merge(local({ account: 'bea', settings: { values: values('sepia'), at: 5 } }), remote(), 'ada')
    expect(result.write.settings).toBeUndefined()
    expect(result.changed).toEqual(['reading', 'listening'])
    expect(result.push).toEqual({})
  })
})
