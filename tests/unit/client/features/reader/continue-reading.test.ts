import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearPrivateReading,
  inLibrary,
  MAX_RECENT,
  placeFor,
  readRecent,
  rememberReading,
  resetVisits,
  upsertRecent,
  visitOf,
  writeRecent,
} from '~/client/features/reader/continue-reading'
import { privateBookSlug } from '~/shared/content/book-slug'
import { buildReaderView, type ReaderView } from '~/shared/content/reader-view'
import { chapterFixture, metaFor, pagedFixture } from '../../../../fixtures/books'
import { fixtureCatalog } from '../../../../fixtures/catalog'

const PRIVATE_5678 = privateBookSlug('56785678-0000-4000-8000-000000000000')

const PRIVATE_1234 = privateBookSlug('12341234-0000-4000-8000-000000000000')

const entry = (slug: string, at: number) => ({
  bookSlug: slug,
  bookTitle: slug,
  chapterTitle: 'c',
  href: `/read/${slug}/1`,
  at,
})

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

const view = (slug: 'essays' | 'confessions', part: string, n?: string): ReaderView => {
  const content = slug === 'essays' ? chapterFixture : pagedFixture
  const built = buildReaderView({ meta: metaFor(slug), catalog: fixtureCatalog }, content, part, n)
  if (!built) throw new Error(`${slug} ${part} ${n}`)
  return built
}

beforeEach(() => resetVisits())

describe('upsertRecent', () => {
  it('puts the latest book first and replaces its older entry', () => {
    const list = [entry('a', 1), entry('b', 2)]
    expect(upsertRecent(list, entry('a', 3), 4).map((e) => [e.bookSlug, e.at])).toEqual([
      ['a', 3],
      ['b', 2],
    ])
  })

  it('keeps at most max entries', () => {
    expect(upsertRecent([entry('a', 1), entry('b', 2)], entry('c', 3), 2).map((e) => e.bookSlug)).toEqual(['c', 'a'])
  })
})

describe('inLibrary', () => {
  it('drops books that are no longer in the library, keeping the order', () => {
    const list = [entry('gone', 3), entry('a', 2), entry('b', 1)]
    expect(inLibrary(list, new Set(['a', 'b'])).map((e) => e.bookSlug)).toEqual(['a', 'b'])
  })
})

describe('rememberReading', () => {
  it('stores the page with its position and label, newest first', () => {
    const storage = memoryStorage()
    rememberReading(view('essays', 'history', '2'), storage, 100)
    rememberReading(view('confessions', '10'), storage, 200)
    expect(readRecent(storage)).toEqual([
      {
        bookSlug: 'confessions',
        bookTitle: 'The Confessions of Al Ghazzali',
        chapterTitle: 'The Search',
        href: '/read/confessions/10',
        at: 200,
        position: { printedPage: 10 },
        label: 'p. 10',
      },
      expect.objectContaining({
        bookSlug: 'essays',
        href: '/read/essays/history/2',
        position: { chapter: 'history', page: 2 },
        label: 'Ch. 1 · p. 2',
      }),
    ])
  })

  it('keeps 50 books', () => {
    const storage = memoryStorage({
      'recent-reading': JSON.stringify(Array.from({ length: 60 }, (_, i) => entry(`b${i}`, 60 - i))),
    })
    expect(readRecent(storage)).toHaveLength(60)
    rememberReading(view('essays', 'history'), storage, 1000)
    const list = readRecent(storage)
    expect(list).toHaveLength(MAX_RECENT)
    expect(list[0]?.bookSlug).toBe('essays')
  })

  it('is never older than the place it replaces, so the page just read is the newest', () => {
    const storage = memoryStorage({ 'recent-reading': JSON.stringify([entry('essays', 500)]) })
    expect(rememberReading(view('essays', 'history'), storage, 400).at).toBe(501)
  })

  it('records the place before the first view of a book, and every view since', () => {
    const storage = memoryStorage({ 'recent-reading': JSON.stringify([entry('essays', 50)]) })
    expect(visitOf('essays')).toBeNull()
    rememberReading(view('essays', 'history'), storage, 100)
    expect(visitOf('essays')).toEqual({ before: 50, viewedAt: 100 })
    rememberReading(view('essays', 'history', '2'), storage, 200)
    expect(visitOf('essays')).toEqual({ before: 50, viewedAt: 200 })
    rememberReading(view('confessions', '7'), storage, 300)
    expect(visitOf('confessions')).toEqual({ before: 0, viewedAt: 300 })
  })

  it('takes the place before the visit from the list as the page load found it, not from a pull’s write', () => {
    const storage = memoryStorage({ 'recent-reading': JSON.stringify([entry('confessions', 40)]) })
    writeRecent(storage, [entry('essays', 900), entry('confessions', 40)])
    rememberReading(view('essays', 'history'), storage, 1000)
    expect(visitOf('essays')).toEqual({ before: 0, viewedAt: 1000 })
    rememberReading(view('confessions', '7'), storage, 1100)
    expect(visitOf('confessions')?.before).toBe(40)
  })

  it('still remembers the visit when the store is blocked', () => {
    expect(() => rememberReading(view('essays', 'history'), blocked, 10)).not.toThrow()
    expect(visitOf('essays')).toEqual({ before: 0, viewedAt: 10 })
    expect(readRecent(blocked)).toEqual([])
    expect(readRecent(null)).toEqual([])
  })
})

describe('the sync layer’s helpers', () => {
  it('writes a list newest first, keeping 50', () => {
    const storage = memoryStorage()
    writeRecent(storage, [entry('a', 1), entry('b', 3), entry('c', 2)])
    expect(readRecent(storage).map((e) => e.bookSlug)).toEqual(['b', 'c', 'a'])
    writeRecent(
      storage,
      Array.from({ length: 55 }, (_, i) => entry(`b${i}`, i)),
    )
    expect(readRecent(storage)).toHaveLength(50)
    expect(() => writeRecent(blocked, [entry('a', 1)])).not.toThrow()
  })

  it('finds a book’s entry', () => {
    const storage = memoryStorage({ 'recent-reading': JSON.stringify([entry('a', 1), entry('b', 2)]) })
    expect(placeFor('b', storage)?.at).toBe(2)
    expect(placeFor('c', storage)).toBeNull()
  })

  it('ignores entries that aren’t entries', () => {
    const storage = memoryStorage({ 'recent-reading': JSON.stringify([entry('a', 1), { href: 3 }, null, 'x']) })
    expect(readRecent(storage).map((e) => e.bookSlug)).toEqual(['a'])
    expect(readRecent(memoryStorage({ 'recent-reading': '{}' }))).toEqual([])
  })

  it('clears private books’ entries and keeps the catalogue’s', () => {
    const storage = memoryStorage({
      'recent-reading': JSON.stringify([entry(PRIVATE_1234, 3), entry('emma', 2), entry(PRIVATE_5678, 1)]),
    })
    clearPrivateReading(storage)
    expect(readRecent(storage).map((e) => e.bookSlug)).toEqual(['emma'])
    expect(() => clearPrivateReading(blocked)).not.toThrow()
  })
})
