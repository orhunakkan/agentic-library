import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERSIST_ASKED_KEY } from '~/client/features/offline/download'
import { downloadRepo, problemOf, RENDER_RATIO, sleep } from '~/client/features/offline/repo-download'
import { readRepoCopy, readRepoFile, saveRepoCopy } from '~/client/features/offline/repo-store'
import { type OfflineEnv, readNav } from '~/client/features/offline/store'
import { MAX_OFFLINE_BYTES, MAX_OFFLINE_FILES, OFFLINE_BATCH_MAX } from '~/shared/github-repos/offline'
import { FakeCacheStorage, memoryStorage } from '../../../../fixtures/cache-storage'
import {
  NEW_COMMIT,
  OLD_COMMIT,
  REPO_FILES,
  REPO_FOLDERS,
  REPO_ID,
  repoFile,
  repoPlan,
  repoView,
} from '../../../../fixtures/offline-repos'

let storage: FakeCacheStorage
let env: OfflineEnv
let now: number
const MANIFEST = { build: 'aaaaaaaaaaaa', files: ['/_shell.html', '/assets/a.js'] }
const OFFLINE_URL = `/account/repos/${REPO_ID}/offline`

interface Batch {
  commit: string
  paths: string[]
}

type Answer = (batch: Batch, asked: number) => Response | undefined

/** The site: the app's files, the plan and each batch, rendered with `version` in their text. */
function server({ plan = () => Response.json(repoPlan()), batch = (() => undefined) as Answer, version = 'old' } = {}) {
  const batches: Batch[] = []
  const raw: string[] = []
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input), 'http://localhost')
    if (url.pathname === '/app-files.json') return Response.json(MANIFEST)
    if (url.pathname === `/account/repos/${REPO_ID}/raw`) {
      raw.push(url.searchParams.get('path') ?? '')
      return new Response(new Uint8Array(300), { headers: { 'content-type': 'image/png', 'content-length': '300' } })
    }
    if (MANIFEST.files.includes(url.pathname)) return new Response('app file')
    if (url.pathname !== OFFLINE_URL) return new Response('Not found', { status: 404 })
    if (init?.method !== 'POST') return plan()
    const body = JSON.parse(String(init.body)) as Batch
    batches.push(body)
    return batch(body, batches.length) ?? Response.json({ files: body.paths.map((p) => repoFile(p, version)) })
  }) as unknown as typeof fetch
  storage.fetcher = (url) => fetcher(url)
  return { fetcher, batches, raw }
}

const roomy = () => ({
  estimate: vi.fn(async () => ({ quota: 100_000_000, usage: 0 })),
  persist: vi.fn(async () => true),
})

const waits: number[] = []
const wait = async (ms: number) => {
  waits.push(ms)
}

const busy = (retryAt: string | null = null) => Response.json({ error: 'busy', retryAt }, { status: 503 })

beforeEach(() => {
  storage = new FakeCacheStorage()
  now = 1_000_000
  waits.length = 0
  env = { caches: storage.api, storage: memoryStorage(), now: () => now }
})

const download = (
  fetcher: typeof fetch,
  patch: Parameters<typeof downloadRepo>[1] extends infer O ? Partial<O> : never = {},
) => downloadRepo(REPO_ID, { account: 'ada', fetcher, storageManager: roomy(), wait, ...patch }, env)

async function readsInFull(version: string, commit: string) {
  const copy = await readRepoCopy(REPO_ID, env)
  expect(copy?.commit).toBe(commit)
  if (!copy) return
  for (const path of REPO_FILES) expect(await readRepoFile(copy, path, env)).toEqual(repoFile(path, version))
}

describe('downloadRepo', () => {
  it('keeps the app files, every batch and the sidebar’s data, and reports progress per batch to 100', async () => {
    const files = Array.from({ length: OFFLINE_BATCH_MAX * 2 + 1 }, (_, i) => `src/f${i}.ts`)
    const { fetcher, batches } = server({ plan: () => Response.json(repoPlan({ files })) })
    const progress: number[] = []
    const result = await download(fetcher, { nav: { stats: 1 }, onProgress: (p) => progress.push(p) })
    expect(result).toMatchObject({ result: 'ok', copy: { id: REPO_ID, account: 'ada', commit: OLD_COMMIT } })
    expect(batches.map((b) => b.paths.length)).toEqual([OFFLINE_BATCH_MAX, OFFLINE_BATCH_MAX, 1])
    expect(batches.every((b) => b.commit === OLD_COMMIT)).toBe(true)
    const copy = await readRepoCopy(REPO_ID, env)
    expect(copy?.folders).toEqual(REPO_FOLDERS)
    expect(copy && (await readRepoFile(copy, 'src/f80.ts', env))).toEqual(repoFile('src/f80.ts'))
    expect(await readNav(env)).toEqual({ stats: 1 })
    expect(await storage.has('folio-app-aaaaaaaaaaaa')).toBe(true)
    /** The plan, two app files, three batches and the logo: seven steps. */
    expect(progress).toEqual([0, 14, 29, 43, 57, 71, 86, 100, 100])
  })

  it('checks for room for the rendered size, which is bigger than the source, and asks to persist once', async () => {
    const { fetcher } = server({ plan: () => Response.json(repoPlan({ bytes: 1000, folders: [] })) })
    const tight = { estimate: async () => ({ quota: 1000 * RENDER_RATIO, usage: 0 }), persist: vi.fn(async () => true) }
    expect(RENDER_RATIO).toBe(6)
    expect(await download(fetcher, { storageManager: tight })).toEqual({
      result: 'no_room',
      bytes: 1000 * RENDER_RATIO,
    })
    expect(tight.persist).not.toHaveBeenCalled()
    expect(await storage.keys()).toEqual([])
    const manager = roomy()
    await download(fetcher, { storageManager: manager })
    await download(fetcher, { storageManager: manager })
    expect(manager.persist).toHaveBeenCalledTimes(1)
    expect(env.storage?.getItem(PERSIST_ASKED_KEY)).toBe('1')
  })

  it('says too_large with the server’s numbers, and saves nothing', async () => {
    const tooLarge = { files: 2500, bytes: 1234, maxFiles: MAX_OFFLINE_FILES, maxBytes: MAX_OFFLINE_BYTES }
    const { fetcher } = server({ plan: () => Response.json({ error: 'too_large', ...tooLarge }, { status: 413 }) })
    expect(await download(fetcher)).toEqual({ result: 'too_large', tooLarge })
    expect(await storage.keys()).toEqual([])
  })

  it('fails on a missing, refused or malformed plan or batch, keeping nothing', async () => {
    for (const plan of [
      () => new Response('Not found', { status: 404 }),
      () => Response.json({ error: 'limited' }, { status: 429 }),
      () => Response.json({ ...repoPlan(), repo: repoView({ id: 'someone-else' }) }),
      () => new Response('not json'),
      () => Response.json({ error: 'too_large' }, { status: 413 }),
    ]) {
      const { fetcher } = server({ plan })
      expect(await download(fetcher)).toEqual({ result: 'failed' })
    }
    for (const batch of [
      () => Response.json({ error: 'unavailable' }, { status: 502 }),
      () => Response.json({ files: [] }),
      (body: Batch) => Response.json({ files: body.paths.map((p) => repoFile(`${p}x`)) }),
    ]) {
      const { fetcher } = server({ batch })
      expect(await download(fetcher)).toEqual({ result: 'failed' })
    }
    expect(await storage.keys()).toEqual([])
  })

  it('waits until GitHub’s retry time, or 30 seconds, and tries again three times at most', async () => {
    const retryAt = new Date(now + 5000).toISOString()
    const { fetcher } = server({
      batch: (_, asked) => (asked === 1 ? busy(retryAt) : asked === 2 ? busy() : undefined),
    })
    expect((await download(fetcher)).result).toBe('ok')
    expect(waits).toEqual([5000, 30_000])
    waits.length = 0
    const always = server({ batch: () => busy() })
    expect(await download(always.fetcher)).toEqual({ result: 'failed' })
    expect(waits).toEqual([30_000, 30_000, 30_000])
    expect(always.batches).toHaveLength(4)
    waits.length = 0
    const busyPlan = server({ plan: () => busy() })
    expect(await download(busyPlan.fetcher)).toEqual({ result: 'failed' })
    expect(waits).toHaveLength(3)
  })

  it('gives up at once when GitHub’s retry time is more than two minutes away', async () => {
    const { fetcher, batches } = server({ batch: () => busy(new Date(now + 10 * 60_000).toISOString()) })
    expect(await download(fetcher)).toEqual({ result: 'failed' })
    expect(waits).toEqual([])
    expect(batches).toHaveLength(1)
  })

  it('starts again once when the repository moved to another commit, then fails', async () => {
    let plans = 0
    const plan = () => Response.json(repoPlan({ repo: repoView({ commit: ++plans === 1 ? OLD_COMMIT : NEW_COMMIT }) }))
    const { fetcher, batches } = server({
      plan,
      batch: (body) => (body.commit === OLD_COMMIT ? Response.json({ error: 'changed' }, { status: 409 }) : undefined),
    })
    expect(await download(fetcher)).toMatchObject({ result: 'ok', copy: { commit: NEW_COMMIT } })
    expect(plans).toBe(2)
    expect(batches.at(-1)?.commit).toBe(NEW_COMMIT)
    const moving = server({ batch: () => Response.json({ error: 'changed' }, { status: 409 }) })
    expect(await download(moving.fetcher)).toEqual({ result: 'failed' })
  })

  it('is cancelled by its signal, and says no_room when the disk fills partway', async () => {
    const { fetcher } = server()
    const controller = new AbortController()
    const cancelled = await download(fetcher, {
      signal: controller.signal,
      onProgress: (p) => p > 50 && controller.abort(),
    })
    expect(cancelled).toEqual({ result: 'cancelled' })
    expect(await readRepoCopy(REPO_ID, env)).toBeNull()
    const cache = await storage.open('folio-repos-v1')
    cache.put = async () => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    }
    expect(await download(fetcher)).toEqual({ result: 'no_room', bytes: 360 * RENDER_RATIO + 300 })
  })

  it('leaves no app files behind when one of them fails', async () => {
    const { fetcher } = server()
    const failing = (async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input instanceof Request ? input.url : input).endsWith('/assets/a.js')
        ? new Response('', { status: 500 })
        : fetcher(input, init)) as typeof fetch
    storage.fetcher = (url) => failing(url)
    expect(await download(failing)).toEqual({ result: 'failed' })
    expect(await storage.keys()).toEqual([])
  })

  describe('an update over a copy already here', () => {
    beforeEach(async () => {
      async function* old() {
        yield REPO_FILES.map((p) => repoFile(p, 'old'))
      }
      await saveRepoCopy(
        { id: REPO_ID, account: 'ada', repo: repoView(), folders: REPO_FOLDERS, files: REPO_FILES },
        old(),
        {},
        env,
      )
    })

    const newPlan = () => Response.json(repoPlan({ repo: repoView({ commit: NEW_COMMIT }) }))

    it('replaces it when whole', async () => {
      const { fetcher } = server({ plan: newPlan, version: 'new' })
      expect((await download(fetcher)).result).toBe('ok')
      await readsInFull('new', NEW_COMMIT)
    })

    it('keeps it whole when a batch fails partway, is cancelled or runs out of room', async () => {
      const files = [...REPO_FILES, ...Array.from({ length: OFFLINE_BATCH_MAX }, (_, i) => `more/f${i}.ts`)]
      const plan = () => Response.json(repoPlan({ repo: repoView({ commit: NEW_COMMIT }), files }))
      const failing = server({
        plan,
        version: 'new',
        batch: (_, asked) => (asked === 2 ? new Response('', { status: 502 }) : undefined),
      })
      expect(await download(failing.fetcher)).toEqual({ result: 'failed' })
      await readsInFull('old', OLD_COMMIT)
      const controller = new AbortController()
      const cancelling = server({ plan, version: 'new' })
      const cancelled = await download(cancelling.fetcher, {
        signal: controller.signal,
        onProgress: (p) => p > 60 && controller.abort(),
      })
      expect(cancelled).toEqual({ result: 'cancelled' })
      await readsInFull('old', OLD_COMMIT)
      const cache = await storage.open('folio-repos-v1')
      const put = cache.put.bind(cache)
      let puts = 0
      cache.put = async (request, response) => {
        if (++puts > 3) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
        return put(request, response)
      }
      expect((await download(server({ plan, version: 'new' }).fetcher)).result).toBe('no_room')
      cache.put = put
      await readsInFull('old', OLD_COMMIT)
      expect(
        storage.caches
          .get('folio-repos-v1')
          ?.paths()
          .filter((p) => p.includes(NEW_COMMIT)),
      ).toEqual([])
    })
  })
})

describe('a failed download whose clean-up fails too', () => {
  it('still answers failed', async () => {
    const { fetcher } = server({ plan: () => new Response('Not found', { status: 404 }) })
    const refusing = {
      has: async () => Promise.reject(new DOMException('blocked', 'SecurityError')),
    } as unknown as CacheStorage
    const result = await downloadRepo(
      REPO_ID,
      { account: 'ada', fetcher, storageManager: null, wait },
      { ...env, caches: refusing },
    )
    expect(result).toEqual({ result: 'failed' })
  })
})

describe('pictures', () => {
  const pictureEntry = (i: number, size = 300) => ({
    name: `p${i}.png`,
    path: `img/p${i}.png`,
    kind: 'file' as const,
    size,
  })
  const withPictures = (count: number, size = 300) =>
    repoPlan({
      folders: [
        ...REPO_FOLDERS,
        { path: 'img', entries: Array.from({ length: count }, (_, i) => pictureEntry(i, size)), readme: null },
      ],
    })

  it('keeps the logo and each picture through the raw route, and counts them in the progress and the room', async () => {
    const { fetcher, raw } = server({ plan: () => Response.json(withPictures(2)) })
    const progress: number[] = []
    const result = await download(fetcher, { onProgress: (p) => progress.push(p) })
    expect(result).toMatchObject({
      result: 'ok',
      copy: { pictures: ['img/p0.png', 'img/p1.png', 'logo.png'], picturesSkipped: false },
    })
    expect(raw.sort()).toEqual(['img/p0.png', 'img/p1.png', 'logo.png'])
    /** The plan, two app files, one batch and three pictures: seven steps. */
    expect(progress).toEqual([0, 14, 29, 43, 57, 71, 86, 100, 100])
    const tight = {
      estimate: async () => ({ quota: (360 * RENDER_RATIO + 900) * 1.2, usage: 0 }),
      persist: async () => true,
    }
    expect((await download(fetcher, { storageManager: tight })).result).toBe('ok')
    const tighter = {
      estimate: async () => ({ quota: (360 * RENDER_RATIO + 900) * 1.2 - 1, usage: 0 }),
      persist: async () => true,
    }
    expect(await download(fetcher, { storageManager: tighter })).toEqual({
      result: 'no_room',
      bytes: 360 * RENDER_RATIO + 900,
    })
  })

  it('keeps none past 200 pictures, and says so in the copy', async () => {
    const { fetcher, raw } = server({ plan: () => Response.json(withPictures(200)) })
    expect(await download(fetcher)).toMatchObject({ result: 'ok', copy: { pictures: [], picturesSkipped: true } })
    expect(raw).toEqual([])
  })
})

describe('problemOf', () => {
  it('says why a download saved nothing, and nothing for one that did or was cancelled', () => {
    const tooLarge = { files: null, bytes: null, maxFiles: MAX_OFFLINE_FILES, maxBytes: MAX_OFFLINE_BYTES }
    expect(problemOf({ result: 'too_large', tooLarge })).toEqual({ kind: 'too_large', tooLarge })
    expect(problemOf({ result: 'no_room', bytes: 5 })).toEqual({ kind: 'no_room', bytes: 5 })
    expect(problemOf({ result: 'failed' })).toEqual({ kind: 'failed' })
    expect(problemOf({ result: 'cancelled' })).toBeNull()
  })
})

describe('sleep', () => {
  it('waits the time it’s given, and stops when its signal aborts', async () => {
    vi.useFakeTimers()
    try {
      let woke = false
      const waiting = sleep(30_000).then(() => {
        woke = true
      })
      await vi.advanceTimersByTimeAsync(29_999)
      expect(woke).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      await waiting
      expect(woke).toBe(true)
      const controller = new AbortController()
      const cut = sleep(30_000, controller.signal)
      controller.abort(new Error('cancelled'))
      await expect(cut).rejects.toThrow('cancelled')
    } finally {
      vi.useRealTimers()
    }
  })
})
