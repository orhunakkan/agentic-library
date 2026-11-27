import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  askPersistOnce,
  defaultStorageManager,
  downloadBook,
  hasRoom,
  PERSIST_ASKED_KEY,
  refreshCopy,
} from '~/client/features/offline/download'
import { BOOKS_CACHE, type OfflineEnv, readCopy, readNav, saveBook } from '~/client/features/offline/store'
import { FakeCacheStorage, memoryStorage } from '../../../../fixtures/cache-storage'
import { catalogueCopy, fileServer } from '../../../../fixtures/offline-books'

let storage: FakeCacheStorage
let env: OfflineEnv
const MANIFEST = { build: 'aaaaaaaaaaaa', files: ['/_shell.html', '/assets/a.js'] }

function server(
  book: () => Response = () => Response.json(catalogueCopy()),
  fail: (url: string) => boolean = () => false,
) {
  const files = fileServer(fail)
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.endsWith('/offline/essays.json')) return book()
    if (url.endsWith('/app-files.json')) return Response.json(MANIFEST)
    return files.fetcher(url)
  }) as unknown as typeof fetch
  storage.fetcher = (url) => fetcher(url)
  return fetcher
}

const roomy = () => ({
  estimate: vi.fn(async () => ({ quota: 10_000_000, usage: 0 })),
  persist: vi.fn(async () => true),
})

beforeEach(() => {
  storage = new FakeCacheStorage()
  env = { caches: storage.api, storage: memoryStorage(), now: () => 1 }
})

describe('downloadBook', () => {
  it('keeps the app files, the book and the sidebar’s data, and reports progress to 100', async () => {
    const fetcher = server()
    const progress: number[] = []
    const result = await downloadBook(
      'essays',
      { fetcher, nav: { stats: 1 }, storageManager: roomy(), onProgress: (p) => progress.push(p) },
      env,
    )
    expect(result).toEqual({ result: 'ok', book: catalogueCopy() })
    expect(await readCopy('essays', env)).toEqual(catalogueCopy())
    expect(await readNav(env)).toEqual({ stats: 1 })
    expect(await storage.has('folio-app-aaaaaaaaaaaa')).toBe(true)
    expect(progress).toEqual([0, 20, 40, 60, 80, 100, 100])
  })

  it('says there’s no room from the estimate, with the book’s size', async () => {
    const fetcher = server()
    const manager = { estimate: async () => ({ quota: 1000, usage: 0 }), persist: vi.fn(async () => true) }
    expect(await downloadBook('essays', { fetcher, storageManager: manager }, env)).toEqual({
      result: 'no_room',
      bytes: 2048,
    })
    expect(manager.persist).not.toHaveBeenCalled()
    expect(await storage.keys()).toEqual([])
  })

  it('asks for persistent storage once ever', async () => {
    const fetcher = server()
    const manager = roomy()
    await downloadBook('essays', { fetcher, storageManager: manager }, env)
    await downloadBook('essays', { fetcher, storageManager: manager }, env)
    expect(manager.persist).toHaveBeenCalledTimes(1)
    expect(env.storage?.getItem(PERSIST_ASKED_KEY)).toBe('1')
    const blocked = { ...env, storage: memoryStorage(true) }
    expect((await downloadBook('essays', { fetcher, storageManager: manager }, blocked)).result).toBe('ok')
    expect(manager.persist).toHaveBeenCalledTimes(1)
  })

  it('fails on a 404 and on a malformed body, keeping nothing', async () => {
    for (const answer of [
      () => new Response('Not found', { status: 404 }),
      () => Response.json({ ...catalogueCopy(), v: 2 }),
      () => new Response('not json'),
      () => Response.json({ ...catalogueCopy(), slug: 'walden' }),
    ]) {
      const fetcher = server(answer)
      expect(await downloadBook('essays', { fetcher, storageManager: null }, env)).toEqual({ result: 'failed' })
    }
    expect(await storage.keys()).toEqual([])
  })

  it('fails when a file fails, and is cancelled by its signal, leaving no app files behind', async () => {
    const failing = server(undefined, (url) => url.endsWith('.svg'))
    expect(await downloadBook('essays', { fetcher: failing, storageManager: null }, env)).toEqual({ result: 'failed' })
    expect(await storage.keys()).toEqual([])
    const fetcher = server()
    const controller = new AbortController()
    const result = await downloadBook(
      'essays',
      { fetcher, storageManager: null, signal: controller.signal, onProgress: (p) => p > 0 && controller.abort() },
      env,
    )
    expect(result).toEqual({ result: 'cancelled' })
    expect(await readCopy('essays', env)).toBeNull()
    expect(await storage.keys()).toEqual([])
  })
})

/** Cache Storage that refuses every call, as when the browser has blocked it. */
const refusing = {
  has: async () => Promise.reject(new DOMException('blocked', 'SecurityError')),
  open: async () => Promise.reject(new DOMException('blocked', 'SecurityError')),
  keys: async () => Promise.reject(new DOMException('blocked', 'SecurityError')),
  delete: async () => Promise.reject(new DOMException('blocked', 'SecurityError')),
} as unknown as CacheStorage

describe('askPersistOnce and defaultStorageManager', () => {
  it('shrugs off a refused persist, and uses the browser’s storage manager when there is one', async () => {
    const manager = { estimate: async () => ({}), persist: vi.fn(async () => Promise.reject(new Error('no'))) }
    await expect(askPersistOnce(env, manager)).resolves.toBeUndefined()
    expect(manager.persist).toHaveBeenCalledOnce()
    expect(defaultStorageManager()).toBe(navigator.storage ?? null)
  })

  it('a failed download still answers failed when the clean-up fails too', async () => {
    const fetcher = server(() => new Response('Not found', { status: 404 }))
    expect(await downloadBook('essays', { fetcher, storageManager: null }, { ...env, caches: refusing })).toEqual({
      result: 'failed',
    })
  })
})

describe('hasRoom', () => {
  it('needs the size with a margin, and says yes when the browser can’t tell', async () => {
    const manager = (quota?: number, usage?: number) => ({
      estimate: async () => ({ quota, usage }),
      persist: async () => true,
    })
    expect(await hasRoom(1000, manager(1200, 0))).toBe(true)
    expect(await hasRoom(1000, manager(1199, 0))).toBe(false)
    expect(await hasRoom(1000, manager(5000, 4000))).toBe(false)
    expect(await hasRoom(1000, manager(undefined))).toBe(true)
    expect(await hasRoom(1000, null)).toBe(true)
    const throwing = { estimate: async () => Promise.reject(new Error('no')), persist: async () => true }
    expect(await hasRoom(1000, throwing)).toBe(true)
  })
})

describe('refreshCopy', () => {
  it('replaces the copy, and keeps the old one when the new one can’t be had', async () => {
    server()
    await saveBook(catalogueCopy(), {}, env)
    const newer = server(() => Response.json(catalogueCopy({ version: '1111111111111111' })))
    expect(await refreshCopy('essays', { fetcher: newer }, env)).toBe(true)
    expect((await readCopy('essays', env))?.version).toBe('1111111111111111')
    const gone = server(() => new Response('', { status: 500 }))
    expect(await refreshCopy('essays', { fetcher: gone }, env)).toBe(false)
    const broken = server(undefined, () => true)
    expect(await refreshCopy('essays', { fetcher: broken }, env)).toBe(false)
    expect((await readCopy('essays', env))?.version).toBe('1111111111111111')
    expect(await storage.has(BOOKS_CACHE)).toBe(true)
  })
})
