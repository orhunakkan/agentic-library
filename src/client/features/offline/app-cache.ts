import { isObject } from '~/shared/lib/json-shape'
import { APP_CACHE_PREFIX, addFiles, clearAppCache, hasDownloads, type OfflineEnv, offlineEnv } from './store'

export const APP_FILES_URL = '/app-files.json'
const FILE_CONCURRENCY = 6

export interface AppFilesManifest {
  build: string
  files: string[]
}

export function parseManifest(value: unknown): AppFilesManifest | null {
  if (!isObject(value)) return null
  const { build, files } = value
  if (typeof build !== 'string' || !/^[0-9a-f]{12}$/.test(build)) return null
  if (!Array.isArray(files) || !files.every((f) => typeof f === 'string' && f.startsWith('/') && !f.startsWith('//')))
    return null
  return { build, files }
}

export interface AppCachePlan {
  name: string
  manifest: AppFilesManifest
  missing: string[]
}

export async function planAppCache(
  env: OfflineEnv = offlineEnv(),
  fetcher: typeof fetch = fetch,
): Promise<AppCachePlan | null> {
  if (!env.caches) return null
  const response = await fetcher(APP_FILES_URL, { cache: 'no-store', credentials: 'same-origin' })
  if (!response.ok) throw new Error(`app-files.json: ${response.status}`)
  const manifest = parseManifest(await response.json())
  if (!manifest) throw new Error('app-files.json is malformed')
  const name = `${APP_CACHE_PREFIX}${manifest.build}`
  if (!(await env.caches.has(name))) return { name, manifest, missing: manifest.files }
  const cache = await env.caches.open(name)
  if (await cache.match(APP_FILES_URL)) return { name, manifest, missing: [] }
  const missing: string[] = []
  for (const file of manifest.files) if (!(await cache.match(file))) missing.push(file)
  return { name, manifest, missing }
}

export interface RefreshOptions {
  force?: boolean
  plan?: AppCachePlan | null
  signal?: AbortSignal
  onFile?: () => void
  fetcher?: typeof fetch
}

export async function refreshAppCache(options: RefreshOptions = {}, env: OfflineEnv = offlineEnv()): Promise<void> {
  if (!env.caches) return
  if (!options.force && !(await hasDownloads(env))) return clearAppCache(env)
  const plan = options.plan === undefined ? await planAppCache(env, options.fetcher) : options.plan
  if (!plan) return
  const cache = await env.caches.open(plan.name)
  if (plan.missing.length > 0 || !(await cache.match(APP_FILES_URL))) {
    await addFiles(cache, plan.missing, FILE_CONCURRENCY, options)
    await cache.put(APP_FILES_URL, Response.json(plan.manifest))
  }
  for (const name of await env.caches.keys())
    if (name.startsWith(APP_CACHE_PREFIX) && name !== plan.name) await env.caches.delete(name)
}
