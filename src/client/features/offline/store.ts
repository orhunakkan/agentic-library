import { browserStorage } from '~/client/lib/storage-keys'
import { isPrivateBookSlug } from '~/shared/content/book-slug'
import { firstReadingHref } from '~/shared/content/reader-view'
import { isObject } from '~/shared/lib/json-shape'
import {
  OFFLINE_NAV_URL,
  type OfflineBook,
  offlineBookUrl,
  offlineCoverUrl,
  parseOfflineBook,
} from '~/shared/offline/book'
import { bookOfUrl } from '~/shared/offline/pictures'
import { decodeSummary, encodeSummary, type OfflineSummary, SUMMARY_HEADER } from '~/shared/offline/summary'

export const BOOKS_CACHE = 'folio-books-v1'
export const APP_CACHE_PREFIX = 'folio-app-'
export const CHECKED_KEY = 'offline-checked'
export const CHECK_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
const FILE_CONCURRENCY = 2

export interface OfflineEnv {
  caches: CacheStorage | null
  storage: Storage | null
  now: () => number
}

export function offlineEnv(): OfflineEnv {
  let cacheStorage: CacheStorage | null = null
  try {
    cacheStorage = typeof caches === 'undefined' ? null : caches
  } catch {}
  return { caches: cacheStorage, storage: browserStorage(), now: Date.now }
}

async function booksCache(env: OfflineEnv): Promise<Cache | null> {
  if (!env.caches || !(await env.caches.has(BOOKS_CACHE))) return null
  return env.caches.open(BOOKS_CACHE)
}

const pathOf = (request: Request) => {
  const url = new URL(request.url)
  return { pathname: url.pathname, key: url.pathname + url.search }
}

export function siteRequest(path: string, signal?: AbortSignal): Request {
  const base = typeof location === 'undefined' ? 'http://localhost' : location.href
  return new Request(new URL(path, base), { credentials: 'same-origin', signal })
}

export async function inBatches<T>(items: readonly T[], limit: number, task: (item: T) => Promise<void>) {
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++] as T
      await task(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

export async function listDownloads(env: OfflineEnv = offlineEnv()): Promise<OfflineSummary[]> {
  const cache = await booksCache(env)
  if (!cache) return []
  const summaries: OfflineSummary[] = []
  for (const request of await cache.keys()) {
    const { pathname } = pathOf(request)
    const slug = bookOfUrl(pathname)
    if (!slug || pathname !== offlineBookUrl(slug)) continue
    const summary = decodeSummary((await cache.match(request))?.headers.get(SUMMARY_HEADER) ?? null)
    if (summary?.slug === slug) summaries.push(summary)
  }
  return summaries.sort((a, b) => b.savedAt - a.savedAt)
}

export async function hasDownloads(env: OfflineEnv = offlineEnv()): Promise<boolean> {
  return (await listDownloads(env)).length > 0
}

export async function readCopy(slug: string, env: OfflineEnv = offlineEnv()): Promise<OfflineBook | null> {
  const response = await (await booksCache(env))?.match(offlineBookUrl(slug))
  if (!response) return null
  try {
    const book = parseOfflineBook(await response.json())
    return book?.slug === slug ? book : null
  } catch {
    return null
  }
}

export function bookFiles(book: OfflineBook): string[] {
  const cover = offlineCoverUrl(book.context)
  return cover && !book.pictures.includes(cover) ? [...book.pictures, cover] : [...book.pictures]
}

async function removeEntries(cache: Cache, slug: string, keep: ReadonlySet<string> = new Set()) {
  for (const request of await cache.keys()) {
    const { pathname, key } = pathOf(request)
    if (bookOfUrl(pathname) === slug && !keep.has(key)) await cache.delete(request)
  }
}

export interface SaveOptions {
  signal?: AbortSignal
  onFile?: () => void
}

export async function saveBook(book: OfflineBook, options: SaveOptions = {}, env: OfflineEnv = offlineEnv()) {
  if (!env.caches) throw new Error('Cache Storage is not available')
  const { signal, onFile } = options
  const cache = await env.caches.open(BOOKS_CACHE)
  const bookUrl = offlineBookUrl(book.slug)
  const had = (await cache.match(bookUrl)) !== undefined
  const files = bookFiles(book)
  try {
    await inBatches(files, FILE_CONCURRENCY, async (url) => {
      signal?.throwIfAborted()
      await cache.add(siteRequest(url, signal))
      onFile?.()
    })
    signal?.throwIfAborted()
    const summary: OfflineSummary = {
      slug: book.slug,
      title: book.title,
      author: book.author,
      owner: book.owner,
      bytes: book.bytes,
      savedAt: env.now(),
      start: firstReadingHref(book.content),
    }
    await cache.put(
      bookUrl,
      new Response(JSON.stringify(book), {
        headers: { 'content-type': 'application/json', [SUMMARY_HEADER]: encodeSummary(summary) },
      }),
    )
  } catch (error) {
    if (!had) await removeEntries(cache, book.slug)
    throw error
  }
  await removeEntries(cache, book.slug, new Set([bookUrl, ...files]))
  if (isPrivateBookSlug(book.slug)) stampChecked([book.slug], env)
}

export async function saveNav(nav: unknown, env: OfflineEnv = offlineEnv()): Promise<void> {
  if (!env.caches) return
  const cache = await env.caches.open(BOOKS_CACHE)
  await cache.put(OFFLINE_NAV_URL, Response.json(nav))
}

export async function readNav<T>(env: OfflineEnv = offlineEnv()): Promise<T | null> {
  const response = await (await booksCache(env))?.match(OFFLINE_NAV_URL)
  try {
    return response ? ((await response.json()) as T) : null
  } catch {
    return null
  }
}

export async function clearAppCache(env: OfflineEnv = offlineEnv()): Promise<void> {
  if (!env.caches) return
  for (const name of await env.caches.keys()) if (name.startsWith(APP_CACHE_PREFIX)) await env.caches.delete(name)
}

async function afterRemoval(env: OfflineEnv) {
  if (await hasDownloads(env)) return
  await env.caches?.delete(BOOKS_CACHE)
  await clearAppCache(env)
}

export async function removeDownload(slug: string, env: OfflineEnv = offlineEnv()): Promise<void> {
  const cache = await booksCache(env)
  if (cache) await removeEntries(cache, slug)
  forgetChecked([slug], env)
  await afterRemoval(env)
}

export async function forgetPrivateDownloads(env: OfflineEnv = offlineEnv()): Promise<void> {
  const cache = await booksCache(env)
  const slugs = new Set<string>()
  if (cache) {
    for (const request of await cache.keys()) {
      const slug = bookOfUrl(pathOf(request).pathname)
      if (slug && isPrivateBookSlug(slug)) {
        slugs.add(slug)
        await cache.delete(request)
      }
    }
  }
  forgetChecked([...slugs, ...Object.keys(readChecked(env.storage)).filter(isPrivateBookSlug)], env)
  await afterRemoval(env)
}

export async function sweepOrphans(env: OfflineEnv = offlineEnv()): Promise<void> {
  const cache = await booksCache(env)
  if (cache) {
    const books = new Set((await listDownloads(env)).map((d) => d.slug))
    for (const request of await cache.keys()) {
      const slug = bookOfUrl(pathOf(request).pathname)
      if (slug && !books.has(slug)) await cache.delete(request)
    }
  }
  await afterRemoval(env)
}

export function readChecked(storage: Storage | null): Record<string, number> {
  try {
    const value: unknown = JSON.parse(storage?.getItem(CHECKED_KEY) ?? '{}')
    if (!isObject(value)) return {}
    return Object.fromEntries(Object.entries(value).filter((e): e is [string, number] => typeof e[1] === 'number'))
  } catch {
    return {}
  }
}

function writeChecked(storage: Storage | null, checked: Record<string, number>) {
  try {
    if (Object.keys(checked).length === 0) storage?.removeItem(CHECKED_KEY)
    else storage?.setItem(CHECKED_KEY, JSON.stringify(checked))
  } catch {}
}

export function stampChecked(slugs: readonly string[], env: OfflineEnv = offlineEnv()): void {
  if (slugs.length === 0) return
  const checked = readChecked(env.storage)
  for (const slug of slugs) checked[slug] = env.now()
  writeChecked(env.storage, checked)
}

function forgetChecked(slugs: readonly string[], env: OfflineEnv) {
  const checked = readChecked(env.storage)
  if (!slugs.some((slug) => slug in checked)) return
  for (const slug of slugs) delete checked[slug]
  writeChecked(env.storage, checked)
}

export function mayOpen(slug: string, env: OfflineEnv = offlineEnv()): boolean {
  if (!isPrivateBookSlug(slug)) return true
  const at = readChecked(env.storage)[slug]
  return at !== undefined && env.now() - at <= CHECK_WINDOW_MS
}
