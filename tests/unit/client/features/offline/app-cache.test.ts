import { beforeEach, describe, expect, it } from 'vitest'
import { APP_FILES_URL, parseManifest, planAppCache, refreshAppCache } from '~/client/features/offline/app-cache'
import { type OfflineEnv, saveBook } from '~/client/features/offline/store'
import { FakeCacheStorage, memoryStorage } from '../../../../fixtures/cache-storage'
import { catalogueCopy, fileServer } from '../../../../fixtures/offline-books'

let storage: FakeCacheStorage
let env: OfflineEnv
const MANIFEST = { build: 'aaaaaaaaaaaa', files: ['/_shell.html', '/assets/a.js', '/assets/b.css'] }

function server(manifest: object = MANIFEST, fail: (url: string) => boolean = () => false) {
  const files = fileServer(fail)
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.endsWith(APP_FILES_URL)) return Response.json(manifest)
    return files.fetcher(url)
  }) as typeof fetch
  storage.fetcher = (url) => fetcher(url)
  return { fetcher, asked: files.asked }
}

beforeEach(() => {
  storage = new FakeCacheStorage()
  env = { caches: storage.api, storage: memoryStorage(), now: () => 1 }
})

describe('refreshAppCache', () => {
  it('keeps nothing without a download, and deletes what is there', async () => {
    const { fetcher, asked } = server()
    await storage.open('folio-app-old')
    await refreshAppCache({ fetcher }, env)
    expect(await storage.keys()).toEqual([])
    expect(asked).toEqual([])
  })

  it('keeps every file, the manifest last, then deletes the other app caches', async () => {
    const { fetcher } = server()
    await saveBook(catalogueCopy(), {}, env)
    await storage.open('folio-app-old')
    const cache = await storage.open('folio-app-aaaaaaaaaaaa')
    const order: string[] = []
    const put = cache.put.bind(cache)
    cache.put = async (request, response) => {
      expect(await storage.has('folio-app-old')).toBe(true)
      order.push(String(request))
      return put(request, response)
    }
    await refreshAppCache({ fetcher }, env)
    expect(order).toEqual([APP_FILES_URL])
    expect(cache.paths()).toEqual(['/_shell.html', '/app-files.json', '/assets/a.js', '/assets/b.css'])
    expect((await storage.keys()).sort()).toEqual(['folio-app-aaaaaaaaaaaa', 'folio-books-v1'])
  })

  it('doesn’t fetch a complete cache again, and finishes an incomplete one', async () => {
    const { fetcher, asked } = server()
    await refreshAppCache({ fetcher, force: true }, env)
    expect(asked).toHaveLength(3)
    await refreshAppCache({ fetcher, force: true }, env)
    expect(asked).toHaveLength(3)
    const cache = await storage.open('folio-app-aaaaaaaaaaaa')
    await cache.delete(APP_FILES_URL)
    await cache.delete('/assets/a.js')
    expect((await planAppCache(env, fetcher))?.missing).toEqual(['/assets/a.js'])
    await refreshAppCache({ fetcher, force: true }, env)
    expect(asked.slice(3)).toEqual(['/assets/a.js'])
    expect(await cache.match(APP_FILES_URL)).toBeDefined()
  })

  it('keeps the old caches when a file fails, and refuses a bad manifest', async () => {
    await storage.open('folio-app-old')
    const failing = server(MANIFEST, (url) => url.endsWith('b.css'))
    await expect(refreshAppCache({ fetcher: failing.fetcher, force: true }, env)).rejects.toThrow()
    expect(await storage.has('folio-app-old')).toBe(true)
    expect(await (await storage.open('folio-app-aaaaaaaaaaaa')).match(APP_FILES_URL)).toBeUndefined()
    const bad = server({ build: 'nope', files: [] })
    await expect(refreshAppCache({ fetcher: bad.fetcher, force: true }, env)).rejects.toThrow('malformed')
    const missing = (async () => new Response('', { status: 404 })) as unknown as typeof fetch
    await expect(planAppCache(env, missing)).rejects.toThrow('404')
  })

  it('does nothing without Cache Storage', async () => {
    const { fetcher, asked } = server()
    const none = { ...env, caches: null }
    await refreshAppCache({ fetcher, force: true }, none)
    expect(await planAppCache(none, fetcher)).toBeNull()
    expect(asked).toEqual([])
  })
})

describe('parseManifest', () => {
  it('takes a build and site paths only', () => {
    expect(parseManifest(MANIFEST)).toEqual(MANIFEST)
    expect(parseManifest(null)).toBeNull()
    expect(parseManifest({ build: 'aaaaaaaaaaaa', files: ['//evil.test/x.js'] })).toBeNull()
    expect(parseManifest({ build: 'aaaaaaaaaaaa', files: 'x' })).toBeNull()
    expect(parseManifest({ build: 'AAAAAAAAAAAA', files: [] })).toBeNull()
  })
})
