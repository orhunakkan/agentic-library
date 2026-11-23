import { type OfflineBook, offlineBookUrl, parseOfflineBook } from '~/shared/offline/book'
import { planAppCache, refreshAppCache } from './app-cache'
import { bookFiles, type OfflineEnv, offlineEnv, saveBook, saveNav, sweepOrphans } from './store'

export const PERSIST_ASKED_KEY = 'offline-persist-asked'
export const ROOM_MARGIN = 1.2

export type DownloadResult =
  | { result: 'ok'; book: OfflineBook }
  | { result: 'no_room'; bytes: number }
  | { result: 'failed' }
  | { result: 'cancelled' }

export interface DownloadOptions {
  nav?: unknown
  signal?: AbortSignal
  onProgress?: (percent: number) => void
  fetcher?: typeof fetch
  storageManager?: Pick<StorageManager, 'estimate' | 'persist'> | null
}

export const defaultStorageManager = () => (typeof navigator === 'undefined' ? null : (navigator.storage ?? null))

async function fetchCopy(slug: string, fetcher: typeof fetch, signal?: AbortSignal): Promise<OfflineBook | null> {
  const response = await fetcher(offlineBookUrl(slug), { cache: 'no-store', credentials: 'same-origin', signal })
  if (!response.ok) return null
  const book = parseOfflineBook(await response.json().catch(() => null))
  return book?.slug === slug ? book : null
}

export async function hasRoom(bytes: number, manager: DownloadOptions['storageManager']): Promise<boolean> {
  try {
    const estimate = await manager?.estimate?.()
    if (!estimate || estimate.quota === undefined) return true
    return estimate.quota - (estimate.usage ?? 0) >= bytes * ROOM_MARGIN
  } catch {
    return true
  }
}

export async function askPersistOnce(env: Pick<OfflineEnv, 'storage'>, manager: DownloadOptions['storageManager']) {
  try {
    if (env.storage?.getItem(PERSIST_ASKED_KEY)) return
    env.storage?.setItem(PERSIST_ASKED_KEY, '1')
  } catch {
    return
  }
  await manager?.persist?.().catch(() => false)
}

export async function downloadBook(
  slug: string,
  options: DownloadOptions = {},
  env: OfflineEnv = offlineEnv(),
): Promise<DownloadResult> {
  const { signal, onProgress, nav } = options
  const fetcher = options.fetcher ?? fetch
  const manager = options.storageManager === undefined ? defaultStorageManager() : options.storageManager
  let done = 0
  let total = 1
  const step = () => {
    done++
    onProgress?.(Math.min(100, Math.round((done / total) * 100)))
  }
  try {
    onProgress?.(0)
    const book = await fetchCopy(slug, fetcher, signal)
    if (!book) return { result: 'failed' }
    if (!(await hasRoom(book.bytes, manager))) return { result: 'no_room', bytes: book.bytes }
    await askPersistOnce(env, manager)
    const plan = await planAppCache(env, fetcher)
    total = 1 + (plan?.missing.length ?? 0) + bookFiles(book).length
    step()
    await refreshAppCache({ force: true, plan, signal, onFile: step, fetcher }, env)
    await saveBook(book, { signal, onFile: step }, env)
    if (nav !== undefined) await saveNav(nav, env)
    onProgress?.(100)
    return { result: 'ok', book }
  } catch {
    await sweepOrphans(env).catch(() => {})
    return { result: signal?.aborted ? 'cancelled' : 'failed' }
  }
}

export async function refreshCopy(
  slug: string,
  options: Pick<DownloadOptions, 'fetcher'> = {},
  env: OfflineEnv = offlineEnv(),
): Promise<boolean> {
  try {
    const book = await fetchCopy(slug, options.fetcher ?? fetch)
    if (!book) return false
    await saveBook(book, {}, env)
    return true
  } catch {
    return false
  }
}
