import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SyncState } from '~/shared/sync/sync'
import { createSync, onSynced, type SyncKind } from './engine'
import { ACCOUNT_KEY } from './local'
import type { Outbox, OutboxItem } from './outbox'

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

const ready = (over: Partial<Omit<Extract<SyncState, { state: 'ready' }>, 'state'>> = {}): SyncState => ({
  state: 'ready',
  reading: [],
  listening: [],
  settings: null,
  ...over,
})

const place = {
  book: 'emma',
  bookTitle: 'Emma',
  chapterTitle: 'Chapter 8',
  href: '/read/emma/chapter-8/3',
  label: 'Ch. 8 · p. 3',
  position: { chapter: 'chapter-8', page: 3 },
  at: 20,
  device: 'Safari on iPhone',
}

function setup(answers: SyncState[], storage = memoryStorage()) {
  const added: OutboxItem[] = []
  const enabled: (string | null)[] = []
  const outbox: Outbox = {
    enable: (a) => void enabled.push(a),
    add: (item) => void added.push(item),
    flush: async () => {},
    size: () => added.length,
    timeSize: () => 0,
  }
  let clock = 1000
  const read = vi.fn(async () => answers.shift() ?? ready())
  const sync = createSync({ storage, read, outbox, now: () => clock, siteDark: () => false })
  const heard: SyncKind[][] = []
  const off = onSynced((kinds) => void heard.push([...kinds]))
  unsubscribes.push(off)
  return { sync, storage, read, added, enabled, heard, tick: (ms: number) => (clock += ms) }
}

const unsubscribes: (() => void)[] = []
afterEach(() => {
  for (const off of unsubscribes.splice(0)) off()
})

describe('the sync engine', () => {
  it('pulls on start: writes the account’s newer items, queues the browser’s, and says what changed', async () => {
    const storage = memoryStorage({
      'recent-reading': JSON.stringify([
        { bookSlug: 'persuasion', bookTitle: 'P', chapterTitle: 'c', href: '/read/persuasion/chapter-1', at: 5 },
      ]),
      'reader-prefs': JSON.stringify({ theme: 'sepia' }),
      'reader-prefs-at': '9',
    })
    const t = setup([ready({ reading: [place] })], storage)
    await t.sync.start('ada')
    expect(t.enabled).toEqual(['ada'])
    expect(storage.getItem(ACCOUNT_KEY)).toBe('ada')
    expect(JSON.parse(storage.getItem('recent-reading') ?? '[]').map((e: { bookSlug: string }) => e.bookSlug)).toEqual([
      'emma',
      'persuasion',
    ])
    expect(t.added).toEqual([
      { book: 'persuasion', position: { chapter: 'chapter-1', page: 1 }, at: 5 },
      expect.objectContaining({ values: expect.objectContaining({ theme: 'sepia' }), at: 9 }),
    ])
    expect(t.heard).toEqual([['reading']])
  })

  it('tells nobody when nothing changed', async () => {
    const t = setup([ready()])
    await t.sync.start('ada')
    expect(t.heard).toEqual([])
  })

  it('stops, and switches the outbox off, when the account says signed out', async () => {
    const t = setup([{ state: 'signed_out' }])
    await t.sync.start('ada')
    expect(t.enabled).toEqual(['ada', null])
    await t.sync.pull()
    expect(t.read).toHaveBeenCalledTimes(1)
  })

  it('changes nothing when the account is unavailable, and tries again on the next pull', async () => {
    const t = setup([{ state: 'unavailable' }, ready({ reading: [place] })])
    await t.sync.start('ada')
    expect(t.storage.getItem('recent-reading')).toBeNull()
    expect(t.storage.getItem(ACCOUNT_KEY)).toBeNull()
    await t.sync.pull()
    expect(t.storage.getItem('recent-reading')).not.toBeNull()
  })

  it('runs a pull asked for during another once, after it', async () => {
    const t = setup([ready(), ready(), ready()])
    const first = t.sync.start('ada')
    const second = t.sync.pull()
    const third = t.sync.pull()
    await Promise.all([first, second, third])
    expect(t.read).toHaveBeenCalledTimes(2)
  })

  it('pulls when stale only, and not at all once stopped', async () => {
    const t = setup([])
    await t.sync.start('ada')
    await t.sync.pullIfStale(60_000)
    expect(t.read).toHaveBeenCalledTimes(1)
    t.tick(60_000)
    await t.sync.pullIfStale(60_000)
    expect(t.read).toHaveBeenCalledTimes(2)
    t.sync.stop()
    t.tick(60_000)
    await t.sync.pullIfStale(60_000)
    await t.sync.pull()
    expect(t.read).toHaveBeenCalledTimes(2)
    expect(t.enabled).toEqual(['ada', null])
  })

  it('drops an answer for an account that stopped meanwhile', async () => {
    const t = setup([ready({ reading: [place] })])
    const pulling = t.sync.start('ada')
    t.sync.stop()
    await pulling
    expect(t.storage.getItem('recent-reading')).toBeNull()
  })

  it('starting again for the same reader only pulls', async () => {
    const t = setup([])
    await t.sync.start('ada')
    await t.sync.start('ada')
    expect(t.enabled).toEqual(['ada'])
    expect(t.read).toHaveBeenCalledTimes(2)
  })

  it('lets a listener unsubscribe', async () => {
    const heard: unknown[] = []
    const off = onSynced((k) => void heard.push(k))
    off()
    const t = setup([ready({ reading: [place] })])
    await t.sync.start('ada')
    expect(heard).toEqual([])
  })
})
