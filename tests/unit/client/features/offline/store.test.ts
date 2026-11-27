import { beforeEach, describe, expect, it } from 'vitest'
import {
  BOOKS_CACHE,
  CHECK_WINDOW_MS,
  CHECKED_KEY,
  clearAppCache,
  forgetPrivateDownloads,
  hasDownloads,
  inBatches,
  listDownloads,
  mayOpen,
  type OfflineEnv,
  offlineEnv,
  readChecked,
  readCopy,
  readNav,
  removeDownload,
  saveBook,
  saveNav,
  stampChecked,
  sweepOrphans,
} from '~/client/features/offline/store'
import { privateBookSlug } from '~/shared/content/book-slug'
import { OFFLINE_NAV_URL } from '~/shared/offline/book'
import { FakeCacheStorage, memoryStorage } from '../../../../fixtures/cache-storage'
import {
  CATALOGUE_PICTURE,
  catalogueCopy,
  fileServer,
  PRIVATE_COVER,
  PRIVATE_PICTURE,
  PRIVATE_SLUG,
  privateCopy,
} from '../../../../fixtures/offline-books'

let storage: FakeCacheStorage
let env: OfflineEnv
let now: number

beforeEach(() => {
  storage = new FakeCacheStorage()
  storage.fetcher = fileServer().fetcher
  now = 1_000_000
  env = { caches: storage.api, storage: memoryStorage(), now: () => now }
})

const books = () => storage.caches.get(BOOKS_CACHE)

describe('saveBook', () => {
  it('writes the book after its pictures and cover, with its summary', async () => {
    const order: string[] = []
    const cache = await storage.open(BOOKS_CACHE)
    const put = cache.put.bind(cache)
    cache.put = async (request, response) => {
      order.push(String(request))
      return put(request, response)
    }
    const add = cache.add.bind(cache)
    cache.add = async (request) => {
      order.push(new URL((request as Request).url).pathname)
      return add(request)
    }
    await saveBook(catalogueCopy(), {}, env)
    expect(order).toEqual([CATALOGUE_PICTURE, '/covers/essays.svg', '/offline/essays.json'])
    expect(await readCopy('essays', env)).toEqual(catalogueCopy())
    expect(await listDownloads(env)).toEqual([
      {
        slug: 'essays',
        title: 'Essays',
        author: 'Author',
        owner: null,
        bytes: 2048,
        savedAt: now,
        start: '/read/essays/history',
      },
    ])
  })

  it('leaves nothing when a picture fails or the download is cancelled', async () => {
    storage.fetcher = fileServer((url) => url.endsWith('.svg')).fetcher
    await expect(saveBook(catalogueCopy(), {}, env)).rejects.toThrow()
    expect(books()?.paths()).toEqual([])
    storage.fetcher = fileServer().fetcher
    const controller = new AbortController()
    const saving = saveBook(catalogueCopy(), { signal: controller.signal, onFile: () => controller.abort() }, env)
    await expect(saving).rejects.toThrow()
    expect(books()?.paths()).toEqual([])
    expect(await hasDownloads(env)).toBe(false)
  })

  it('keeps the old copy when a refresh fails, and drops pictures a new copy no longer has', async () => {
    await saveBook(catalogueCopy(), {}, env)
    storage.fetcher = fileServer(() => true).fetcher
    await expect(saveBook(catalogueCopy({ version: '1111111111111111' }), {}, env)).rejects.toThrow()
    expect((await readCopy('essays', env))?.version).toBe('0123456789abcdef')
    storage.fetcher = fileServer().fetcher
    await saveBook(catalogueCopy({ pictures: [] }), {}, env)
    expect(books()?.paths()).toEqual(['/covers/essays.svg', '/offline/essays.json'])
  })

  it('stamps a private copy as confirmed', async () => {
    await saveBook(privateCopy(), {}, env)
    expect(readChecked(env.storage)).toEqual({ [PRIVATE_SLUG]: now })
    expect(books()?.paths()).toEqual([PRIVATE_COVER, PRIVATE_PICTURE, `/offline/${PRIVATE_SLUG}.json`].sort())
  })

  it('refuses without Cache Storage', async () => {
    await expect(saveBook(catalogueCopy(), {}, { ...env, caches: null })).rejects.toThrow('not available')
  })
})

describe('listDownloads and readCopy', () => {
  it('list newest first, and never create the cache', async () => {
    expect(await listDownloads(env)).toEqual([])
    expect(await readCopy('essays', env)).toBeNull()
    expect(await readNav(env)).toBeNull()
    expect(await storage.keys()).toEqual([])
    await saveBook(catalogueCopy(), {}, env)
    now += 1000
    await saveBook(privateCopy(), {}, env)
    expect((await listDownloads(env)).map((d) => d.slug)).toEqual([PRIVATE_SLUG, 'essays'])
  })

  it('treat a copy this version can’t read as not downloaded', async () => {
    const cache = await storage.open(BOOKS_CACHE)
    await cache.put('/offline/essays.json', Response.json({ ...catalogueCopy(), v: 2 }))
    expect(await readCopy('essays', env)).toBeNull()
    await cache.put('/offline/essays.json', new Response('not json'))
    expect(await readCopy('essays', env)).toBeNull()
    expect(await listDownloads(env)).toEqual([])
  })
})

describe('removeDownload', () => {
  it('takes only that book’s pictures and cover', async () => {
    await saveBook(catalogueCopy(), {}, env)
    await saveBook(privateCopy(), {}, env)
    await removeDownload(PRIVATE_SLUG, env)
    expect(books()?.paths()).toEqual([CATALOGUE_PICTURE, '/covers/essays.svg', '/offline/essays.json'].sort())
    expect(readChecked(env.storage)).toEqual({})
  })

  it('with the last book, deletes the cache, the sidebar’s data and the app files', async () => {
    await saveBook(catalogueCopy(), {}, env)
    await saveNav({ stats: {} }, env)
    expect(await readNav(env)).toEqual({ stats: {} })
    await storage.open('folio-app-abc')
    await storage.open('folio-offline-v2')
    await removeDownload('essays', env)
    expect(await storage.keys()).toEqual(['folio-offline-v2'])
  })

  it('reads a malformed sidebar copy as none', async () => {
    await (await storage.open(BOOKS_CACHE)).put(OFFLINE_NAV_URL, new Response('{not json'))
    expect(await readNav(env)).toBeNull()
  })
})

describe('forgetPrivateDownloads', () => {
  it('removes private copies, orphans included, and keeps catalogue copies', async () => {
    await saveBook(catalogueCopy(), {}, env)
    await saveBook(privateCopy(), {}, env)
    await (await storage.open(BOOKS_CACHE)).put(
      '/account/books/11111111-2222-4333-8444-555555555555/images/1',
      new Response('x'),
    )
    stampChecked([privateBookSlug('11111111-2222-4333-8444-555555555555')], env)
    await forgetPrivateDownloads(env)
    expect(books()?.paths()).toEqual([CATALOGUE_PICTURE, '/covers/essays.svg', '/offline/essays.json'].sort())
    expect(env.storage?.getItem(CHECKED_KEY)).toBeNull()
  })

  it('does nothing harmful when nothing is downloaded', async () => {
    await forgetPrivateDownloads(env)
    await sweepOrphans(env)
    await clearAppCache(env)
    expect(await storage.keys()).toEqual([])
  })
})

describe('sweepOrphans', () => {
  it('deletes entries whose book isn’t there', async () => {
    await saveBook(catalogueCopy(), {}, env)
    const cache = await storage.open(BOOKS_CACHE)
    await cache.put('/images/walden/0123456789ab.png', new Response('x'))
    await sweepOrphans(env)
    expect(books()?.paths()).toEqual([CATALOGUE_PICTURE, '/covers/essays.svg', '/offline/essays.json'].sort())
    await cache.delete('/offline/essays.json')
    await sweepOrphans(env)
    expect(await storage.has(BOOKS_CACHE)).toBe(false)
  })
})

describe('offline-checked', () => {
  it('lets a private copy open for 30 days after its last check, a catalogue copy always', () => {
    expect(mayOpen('essays', env)).toBe(true)
    expect(mayOpen(PRIVATE_SLUG, env)).toBe(false)
    stampChecked([PRIVATE_SLUG], env)
    now += CHECK_WINDOW_MS
    expect(mayOpen(PRIVATE_SLUG, env)).toBe(true)
    now += 1
    expect(mayOpen(PRIVATE_SLUG, env)).toBe(false)
  })

  it('treats a blocked or malformed store as no memory, not an error', () => {
    const blocked = { ...env, storage: memoryStorage(true) }
    expect(() => stampChecked([PRIVATE_SLUG], blocked)).not.toThrow()
    expect(readChecked(blocked.storage)).toEqual({})
    expect(mayOpen(PRIVATE_SLUG, blocked)).toBe(false)
    env.storage?.setItem(CHECKED_KEY, '[1]')
    expect(readChecked(env.storage)).toEqual({})
    env.storage?.setItem(CHECKED_KEY, JSON.stringify({ a: 1, b: 'x' }))
    expect(readChecked(env.storage)).toEqual({ a: 1 })
    stampChecked([], env)
  })
})

describe('inBatches and offlineEnv', () => {
  it('runs at most `limit` at once and stops at the first failure', async () => {
    let running = 0
    let most = 0
    await inBatches([1, 2, 3, 4, 5], 2, async () => {
      running++
      most = Math.max(most, running)
      await new Promise((resolve) => setTimeout(resolve, 1))
      running--
    })
    expect(most).toBe(2)
    await expect(
      inBatches([1, 2], 2, async (n) => {
        if (n === 2) throw new Error('two')
      }),
    ).rejects.toThrow('two')
  })

  it('has no Cache Storage under Node, and keeps working without it', async () => {
    const plain = offlineEnv()
    expect(plain.caches).toBeNull()
    expect(await listDownloads(plain)).toEqual([])
    await removeDownload('essays', plain)
    await saveNav({}, plain)
    expect(OFFLINE_NAV_URL).toBe('/offline/nav.json')
  })
})
