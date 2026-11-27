import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ENGINE_URLS } from '~/client/features/read-aloud/piper/engine-files'
import { createVoiceStore, VOICES_CACHE } from '~/client/features/read-aloud/piper/voice-store'
import { ENGINE_BYTES, folioVoice, voiceFiles } from '~/shared/read-aloud/folio-voices'
import { FakeCacheStorage, memoryStorage } from '../../../../../fixtures/cache-storage'

const CORI = folioVoice('en_GB-cori-medium')
const LJ = folioVoice('en_US-ljspeech-medium')
if (!CORI || !LJ) throw new Error('both English voices are in the catalogue')
const ENGINE = ['/assets/ort-1.wasm', '/assets/piper-1.wasm', '/assets/piper-1.data', '/assets/piper.worker-1.js']

let storage: FakeCacheStorage
let requested: string[]
let files: Map<string, number>

const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input)
  requested.push(url)
  if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError')
  const size = files.get(url)
  if (size === undefined) return new Response('missing', { status: 404 })
  return new Response(new Uint8Array(size), { headers: { 'content-length': String(size) } })
}) as unknown as typeof fetch

const store = (overrides: Partial<Parameters<typeof createVoiceStore>[0]> = {}) =>
  createVoiceStore({
    caches: storage.api,
    fetcher,
    storage: memoryStorage(),
    storageManager: { estimate: async () => ({ quota: 1e12, usage: 0 }), persist: vi.fn(async () => true) },
    engineUrls: ENGINE,
    ...overrides,
  })

beforeEach(() => {
  storage = new FakeCacheStorage()
  requested = []
  files = new Map([...ENGINE, ...[CORI, LJ].flatMap((v) => voiceFiles(v).map((f) => f.url))].map((u) => [u, 1000]))
})

const kept = () => storage.caches.get(VOICES_CACHE)?.paths() ?? []

describe('download', () => {
  it('keeps the engine and the voice, counting progress by bytes', async () => {
    const progress: number[] = []
    const voices = store()
    expect(await voices.status(CORI)).toBe('absent')
    expect(storage.caches.has(VOICES_CACHE)).toBe(false)
    expect(await voices.download(CORI, (p) => progress.push(p))).toBe('ok')
    expect(kept()).toEqual([...ENGINE, ...voiceFiles(CORI).map((f) => f.url)].sort())
    expect(await voices.status(CORI)).toBe('ready')
    expect(await voices.downloaded()).toEqual([CORI])
    expect(progress[0]).toBe(0)
    expect(progress.at(-2)).toBe(Math.floor((7000 / (CORI.bytes + ENGINE_BYTES)) * 100))
    expect(progress.at(-1)).toBe(100)
  })

  it('fetches only the voice once the engine is kept', async () => {
    const voices = store()
    await voices.download(CORI, () => {})
    requested = []
    expect(await voices.download(LJ, () => {})).toBe('ok')
    expect(requested).toEqual(voiceFiles(LJ).map((f) => f.url))
  })

  it('deletes what it saved when a file fails, and never keeps a 404', async () => {
    files.delete(voiceFiles(CORI)[2]?.url as string)
    expect(await store().download(CORI, () => {})).toBe('failed')
    expect(kept()).toEqual([])
  })

  it('deletes what it saved when cancelled', async () => {
    const controller = new AbortController()
    let calls = 0
    const outcome = await store().download(
      CORI,
      () => {
        if (++calls === 3) controller.abort()
      },
      controller.signal,
    )
    expect(outcome).toBe('cancelled')
    expect(kept()).toEqual([])
  })

  it('is no_room when the browser says so, before fetching, or when the cache is full', async () => {
    const small = store({
      storageManager: { estimate: async () => ({ quota: 1000, usage: 0 }), persist: async () => true },
    })
    expect(await small.download(CORI, () => {})).toBe('no_room')
    expect(requested).toEqual([])
    const cache = await storage.open(VOICES_CACHE)
    let puts = 0
    cache.put = async () => {
      if (++puts === 2) throw new DOMException('full', 'QuotaExceededError')
    }
    expect(await store().download(CORI, () => {})).toBe('no_room')
  })

  it('asks for persistent storage once ever', async () => {
    const persist = vi.fn(async () => true)
    const local = memoryStorage()
    const manager = { estimate: async () => ({ quota: 1e12, usage: 0 }), persist }
    await store({ storage: local, storageManager: manager }).download(CORI, () => {})
    await store({ storage: local, storageManager: manager }).download(LJ, () => {})
    expect(persist).toHaveBeenCalledTimes(1)
    expect(local.getItem('offline-persist-asked')).toBe('1')
  })

  it('reads Cache Storage that throws as nothing downloaded', async () => {
    const throwing = {
      has: async () => {
        throw new DOMException('blocked', 'SecurityError')
      },
    } as unknown as CacheStorage
    expect(await store({ caches: throwing }).status(CORI)).toBe('absent')
  })

  it('fails without Cache Storage', async () => {
    const voices = store({ caches: null })
    expect(await voices.download(CORI, () => {})).toBe('failed')
    expect(await voices.status(CORI)).toBe('absent')
  })
})

describe('remove', () => {
  it('keeps the engine while another voice is downloaded, and deletes it with the last', async () => {
    const voices = store()
    await voices.download(CORI, () => {})
    await voices.download(LJ, () => {})
    await voices.remove([CORI])
    expect(await voices.status(CORI)).toBe('absent')
    expect(kept()).toEqual([...ENGINE, ...voiceFiles(LJ).map((f) => f.url)].sort())
    await voices.remove([LJ])
    expect(storage.caches.has(VOICES_CACHE)).toBe(false)
    await voices.remove([LJ])
  })
})

describe('ensureEngine', () => {
  it('replaces an older build’s engine files', async () => {
    await store().download(CORI, () => {})
    const next = ENGINE.map((u) => u.replace('-1', '-2'))
    for (const url of next) files.set(url, 1000)
    const voices = store({ engineUrls: next })
    expect(voices.engineUrls()).toEqual(next)
    await voices.ensureEngine()
    expect(kept()).toEqual([...next, ...voiceFiles(CORI).map((f) => f.url)].sort())
  })

  it('does nothing without a downloaded voice', async () => {
    await store().ensureEngine()
    expect(requested).toEqual([])
  })
})

describe('the engine files', () => {
  it('are this build’s four, the worker among them', () => {
    expect(ENGINE_URLS).toHaveLength(4)
    expect(ENGINE_URLS.some((u) => u.includes('piper.worker'))).toBe(true)
  })
})
