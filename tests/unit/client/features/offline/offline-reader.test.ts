import { beforeEach, describe, expect, it } from 'vitest'
import {
  isOfflineMissing,
  OfflineMissing,
  readerPageFromCopy,
  speechFromCopy,
} from '~/client/features/offline/offline-reader'
import { BOOKS_CACHE, CHECK_WINDOW_MS, type OfflineEnv, readCopy, saveBook } from '~/client/features/offline/store'
import { partialChapterBook } from '~/shared/content/private-book'
import { buildReaderView } from '~/shared/content/reader-view'
import { speechChapter } from '~/shared/read-aloud/speech-text'
import { FakeCacheStorage, memoryStorage } from '../../../../fixtures/cache-storage'
import { fixtureCatalog } from '../../../../fixtures/catalog'
import { catalogueCopy, fileServer, PRIVATE_SLUG, privateCopy } from '../../../../fixtures/offline-books'

let storage: FakeCacheStorage
let env: OfflineEnv
let now: number

beforeEach(() => {
  storage = new FakeCacheStorage()
  storage.fetcher = fileServer().fetcher
  now = 5_000_000
  env = { caches: storage.api, storage: memoryStorage(), now: () => now }
})

describe('readerPageFromCopy', () => {
  it('gives the server’s view of a catalogue page, marked offline', async () => {
    const copy = catalogueCopy()
    await saveBook(copy, {}, env)
    const page = await readerPageFromCopy('essays', 'history', '2', env)
    const server = buildReaderView({ meta: copy.context.meta, catalog: fixtureCatalog }, copy.content, 'history', '2')
    expect(page).toEqual({ view: server, cover: copy.cover, audio: null, offlineVersion: copy.version, offline: true })
  })

  it('gives the server’s view of a private page, which it builds from that page alone', async () => {
    const copy = privateCopy()
    await saveBook(copy, {}, env)
    const page = await readerPageFromCopy(PRIVATE_SLUG, 'morning', '2', env)
    const chapters = copy.content.kind === 'chapter' ? copy.content.chapters : []
    const outline = chapters.map((c) => ({ slug: c.slug, title: c.title, pageCount: c.pages.length }))
    const partial = partialChapterBook(PRIVATE_SLUG, outline, {
      chapterSlug: 'morning',
      index: 1,
      html: chapters[0]?.pages[1] ?? null,
    })
    expect(page.view).toEqual(buildReaderView(copy.context, partial, 'morning', '2'))
  })

  it('is OfflineMissing for no copy, an unreadable copy and a page the book lacks', async () => {
    await expect(readerPageFromCopy('essays', 'history', undefined, env)).rejects.toBeInstanceOf(OfflineMissing)
    await saveBook(catalogueCopy(), {}, env)
    await expect(readerPageFromCopy('essays', 'history', '9', env)).rejects.toSatisfy(isOfflineMissing)
    await expect(readerPageFromCopy('essays', 'nope', undefined, env)).rejects.toSatisfy(isOfflineMissing)
    await (await storage.open(BOOKS_CACHE)).put('/offline/essays.json', Response.json({ ...catalogueCopy(), v: 2 }))
    await expect(readerPageFromCopy('essays', 'history', undefined, env)).rejects.toSatisfy(isOfflineMissing)
    expect(isOfflineMissing(new Error('x'))).toBe(false)
  })

  it('refuses and deletes a private copy 30 days after its last check; a catalogue copy never expires', async () => {
    await saveBook(privateCopy(), {}, env)
    await saveBook(catalogueCopy(), {}, env)
    now += CHECK_WINDOW_MS + 1
    await expect(readerPageFromCopy(PRIVATE_SLUG, 'morning', undefined, env)).rejects.toSatisfy(isOfflineMissing)
    expect(await readCopy(PRIVATE_SLUG, env)).toBeNull()
    expect((await readerPageFromCopy('essays', 'history', undefined, env)).offline).toBe(true)
  })
})

describe('speechFromCopy', () => {
  it('gives a chapter to read aloud and the book as the dock shows it', async () => {
    const copy = catalogueCopy()
    await saveBook(copy, {}, env)
    expect(await speechFromCopy('essays', 1, env)).toEqual({
      book: copy.speech,
      chapter: speechChapter(copy.content, 1),
    })
    await expect(speechFromCopy('essays', 2, env)).rejects.toSatisfy(isOfflineMissing)
    await expect(speechFromCopy('walden', 0, env)).rejects.toSatisfy(isOfflineMissing)
  })
})
