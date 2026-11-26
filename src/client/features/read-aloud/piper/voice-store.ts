import { askPersistOnce, defaultStorageManager, hasRoom } from '~/client/features/offline/download'
import { ENGINE_BYTES, FOLIO_VOICES, type FolioVoice, VOICES_CACHE, voiceFiles } from '~/shared/read-aloud/folio-voices'

export { VOICES_CACHE }

export type DownloadOutcome = 'ok' | 'no_room' | 'failed' | 'cancelled'

export interface VoiceStoreDeps {
  caches: CacheStorage | null
  fetcher?: typeof fetch
  storage: Storage | null
  storageManager?: Pick<StorageManager, 'estimate' | 'persist'> | null
  engineUrls: readonly string[]
}

export interface VoiceStore {
  status: (voice: FolioVoice) => Promise<'ready' | 'absent'>
  downloaded: () => Promise<FolioVoice[]>
  download: (voice: FolioVoice, onProgress: (percent: number) => void, signal?: AbortSignal) => Promise<DownloadOutcome>
  remove: (voices: readonly FolioVoice[]) => Promise<void>
  ensureEngine: () => Promise<void>
  engineUrls: () => readonly string[]
}

class Cancelled extends Error {}
class NoRoom extends Error {}

const isQuota = (error: unknown) =>
  (error as { name?: unknown } | null)?.name === 'QuotaExceededError' ||
  (error as { code?: unknown } | null)?.code === 22

const pathOf = (request: Request) => new URL(request.url).pathname

export function createVoiceStore(deps: VoiceStoreDeps): VoiceStore {
  const fetcher = deps.fetcher ?? ((input, init) => fetch(input, init))
  const manager = deps.storageManager === undefined ? defaultStorageManager() : deps.storageManager

  const existing = async () => {
    try {
      if (!deps.caches || !(await deps.caches.has(VOICES_CACHE))) return null
      return await deps.caches.open(VOICES_CACHE)
    } catch {
      return null
    }
  }

  const has = async (cache: Cache, url: string) => (await cache.match(url)) !== undefined

  const status = async (voice: FolioVoice): Promise<'ready' | 'absent'> => {
    const cache = await existing()
    if (!cache) return 'absent'
    for (const { url } of voiceFiles(voice)) if (!(await has(cache, url))) return 'absent'
    return 'ready'
  }

  const downloaded = async () => {
    const found: FolioVoice[] = []
    for (const voice of FOLIO_VOICES) if ((await status(voice)) === 'ready') found.push(voice)
    return found
  }

  const missingEngine = async (cache: Cache | null) => {
    if (!cache) return [...deps.engineUrls]
    const missing: string[] = []
    for (const url of deps.engineUrls) if (!(await has(cache, url))) missing.push(url)
    return missing
  }

  const keep = async (cache: Cache, url: string, onBytes: (n: number) => void, signal?: AbortSignal) => {
    const response = await fetcher(url, { credentials: 'same-origin', signal })
    if (response.status !== 200 || !response.body) throw new Error(`${url}: ${response.status}`)
    const reader = response.body.getReader()
    const chunks: Uint8Array<ArrayBuffer>[] = []
    for (;;) {
      if (signal?.aborted) throw new Cancelled()
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value as Uint8Array<ArrayBuffer>)
      onBytes(value.byteLength)
    }
    const type = response.headers.get('content-type') ?? 'application/octet-stream'
    try {
      await cache.put(url, new Response(new Blob(chunks, { type }), { headers: { 'content-type': type } }))
    } catch (error) {
      throw isQuota(error) ? new NoRoom() : error
    }
  }

  const deleteUrls = async (cache: Cache, urls: readonly string[]) => {
    for (const url of urls) await cache.delete(url).catch(() => false)
  }

  return {
    status,
    downloaded,
    download: async (voice, onProgress, signal) => {
      if (!deps.caches) return 'failed'
      const engine = await missingEngine(await existing())
      const total = voice.bytes + (engine.length ? ENGINE_BYTES : 0)
      if (!(await hasRoom(total, manager))) return 'no_room'
      await askPersistOnce({ storage: deps.storage }, manager)
      const saved: string[] = []
      let cache: Cache | null = null
      let received = 0
      onProgress(0)
      try {
        cache = await deps.caches.open(VOICES_CACHE)
        const urls = [...engine, ...voiceFiles(voice).map((f) => f.url)]
        for (const url of urls) {
          if (signal?.aborted) throw new Cancelled()
          await keep(
            cache,
            url,
            (n) => {
              received += n
              onProgress(Math.min(99, Math.floor((received / total) * 100)))
            },
            signal,
          )
          saved.push(url)
        }
        onProgress(100)
        return 'ok'
      } catch (error) {
        if (cache) await deleteUrls(cache, saved)
        if (error instanceof Cancelled || signal?.aborted) return 'cancelled'
        if (error instanceof NoRoom || isQuota(error)) return 'no_room'
        return 'failed'
      }
    },
    remove: async (voices) => {
      const cache = await existing()
      if (!cache) return
      await deleteUrls(
        cache,
        voices.flatMap((v) => voiceFiles(v).map((f) => f.url)),
      )
      if ((await downloaded()).length === 0) await deps.caches?.delete(VOICES_CACHE)
    },
    ensureEngine: async () => {
      const cache = await existing()
      if (!cache || (await downloaded()).length === 0) return
      for (const url of await missingEngine(cache)) await keep(cache, url, () => {}).catch(() => {})
      const current = new Set(deps.engineUrls)
      for (const request of await cache.keys()) {
        const path = pathOf(request)
        if (path.startsWith('/assets/') && !current.has(path)) await cache.delete(request)
      }
    },
    engineUrls: () => deps.engineUrls,
  }
}
