import { beforeEach, describe, expect, it } from 'vitest'
import {
  listRepoCopies,
  type NewRepoCopy,
  readRepoCopy,
  readRepoFile,
  removeRepoCopy,
  saveRepoCopy,
  sweepRepoOrphans,
} from '~/client/features/offline/repo-store'
import { APP_CACHE_PREFIX, hasDownloads, type OfflineEnv, saveBook } from '~/client/features/offline/store'
import type { RepoFile } from '~/shared/github-repos/contract'
import { REPOS_CACHE, repoCopyUrl, repoFileUrl } from '~/shared/offline/repo'
import { FakeCacheStorage, memoryStorage } from '../../../../fixtures/cache-storage'
import { catalogueCopy, fileServer } from '../../../../fixtures/offline-books'
import {
  NEW_COMMIT,
  OLD_COMMIT,
  REPO_FILES,
  REPO_FOLDERS,
  REPO_ID,
  repoFile,
  repoView,
} from '../../../../fixtures/offline-repos'

let storage: FakeCacheStorage
let env: OfflineEnv
let now: number

beforeEach(() => {
  storage = new FakeCacheStorage()
  storage.fetcher = fileServer().fetcher
  now = 5_000
  env = { caches: storage.api, storage: memoryStorage(), now: () => now }
})

const repos = () => storage.caches.get(REPOS_CACHE)

const newCopy = (commit = OLD_COMMIT, patch: Partial<NewRepoCopy> = {}): NewRepoCopy => ({
  id: REPO_ID,
  account: 'ada',
  repo: repoView({ commit }),
  folders: REPO_FOLDERS,
  files: REPO_FILES,
  ...patch,
})

/** The copy's files in batches of two, rendered with `version` in their text. */
async function* batchesOf(version = 'old', paths: readonly string[] = REPO_FILES): AsyncGenerator<RepoFile[]> {
  for (let i = 0; i < paths.length; i += 2) yield paths.slice(i, i + 2).map((p) => repoFile(p, version))
}

/** Yields the first batch, then fails as `fail` says: a network error, a full disk or a cancel. */
async function* failingAfterOne(fail: () => never): AsyncGenerator<RepoFile[]> {
  yield [repoFile(REPO_FILES[0] as string, 'new')]
  fail()
}

async function readsInFull(version: string, commit: string) {
  const copy = await readRepoCopy(REPO_ID, env)
  expect(copy?.commit).toBe(commit)
  if (!copy) return
  for (const path of REPO_FILES) expect(await readRepoFile(copy, path, env)).toEqual(repoFile(path, version))
}

const filesOf = (commit: string) =>
  (repos()?.paths() ?? []).filter((p) => p.startsWith(`/offline-repos/${REPO_ID}/${commit}/`))

describe('saveRepoCopy', () => {
  it('writes every file, then the copy’s entry last, with its summary', async () => {
    const cache = await storage.open(REPOS_CACHE)
    const order: string[] = []
    const put = cache.put.bind(cache)
    cache.put = async (request, response) => {
      order.push(new URL(String(request), 'http://localhost').pathname)
      return put(request, response)
    }
    const saved = await saveRepoCopy(newCopy(), batchesOf(), {}, env)
    expect(order.at(-1)).toBe(repoCopyUrl(REPO_ID))
    expect(order.slice(0, -1)).toEqual(
      REPO_FILES.map((p) => new URL(repoFileUrl(REPO_ID, OLD_COMMIT, p), 'http://x').pathname),
    )
    expect(saved).toMatchObject({ v: 1, id: REPO_ID, account: 'ada', commit: OLD_COMMIT, savedAt: now })
    expect(saved.bytes).toBeGreaterThan(JSON.stringify(REPO_FOLDERS).length)
    expect(await readRepoCopy(REPO_ID, env)).toEqual(saved)
    await readsInFull('old', OLD_COMMIT)
    expect(await listRepoCopies(env)).toEqual([
      {
        id: REPO_ID,
        account: 'ada',
        owner: 'folio-test',
        name: 'sample',
        commit: OLD_COMMIT,
        bytes: saved.bytes,
        savedAt: now,
      },
    ])
  })

  it('keys a file by its whole path, so a path with slashes and odd characters reads back', async () => {
    const path = 'docs/a b/ü?#%.md'
    await saveRepoCopy(newCopy(OLD_COMMIT, { files: [path] }), batchesOf('old', [path]), {}, env)
    const copy = await readRepoCopy(REPO_ID, env)
    expect(copy && (await readRepoFile(copy, path, env))?.path).toBe(path)
    expect(copy && (await readRepoFile(copy, 'docs/a b', env))).toBeNull()
  })

  it('leaves nothing when a first download fails, is cancelled, or is missing a file', async () => {
    const failed = saveRepoCopy(
      newCopy(),
      failingAfterOne(() => {
        throw new TypeError('Failed to fetch')
      }),
      {},
      env,
    )
    await expect(failed).rejects.toThrow('Failed to fetch')
    expect(await storage.keys()).toEqual([])
    const controller = new AbortController()
    async function* cancelling() {
      yield [repoFile('logo.png')]
      controller.abort()
      yield [repoFile('README.md')]
    }
    await expect(saveRepoCopy(newCopy(), cancelling(), { signal: controller.signal }, env)).rejects.toThrow()
    expect(await storage.keys()).toEqual([])
    await expect(saveRepoCopy(newCopy(), batchesOf('old', ['logo.png']), {}, env)).rejects.toThrow('missing README.md')
    expect(await storage.keys()).toEqual([])
    expect(await hasDownloads(env)).toBe(false)
  })

  it('switches an update to the new commit only when it’s whole, then drops the old commit’s files', async () => {
    await saveRepoCopy(newCopy(OLD_COMMIT), batchesOf('old'), {}, env)
    now += 1000
    const updated = await saveRepoCopy(newCopy(NEW_COMMIT), batchesOf('new'), {}, env)
    expect(updated.savedAt).toBe(now)
    await readsInFull('new', NEW_COMMIT)
    expect(filesOf(OLD_COMMIT)).toEqual([])
    expect(filesOf(NEW_COMMIT)).toHaveLength(REPO_FILES.length)
  })

  describe('an update that stops partway leaves the old copy whole, and none of the new commit’s files', () => {
    beforeEach(async () => {
      await saveRepoCopy(newCopy(OLD_COMMIT), batchesOf('old'), {}, env)
    })

    it('when a batch fails', async () => {
      const update = failingAfterOne(() => {
        throw new TypeError('Failed to fetch')
      })
      await expect(saveRepoCopy(newCopy(NEW_COMMIT), update, {}, env)).rejects.toThrow()
      await readsInFull('old', OLD_COMMIT)
      expect(filesOf(NEW_COMMIT)).toEqual([])
    })

    it('when it’s cancelled', async () => {
      const controller = new AbortController()
      const update = failingAfterOne(() => {
        controller.abort()
        return controller.signal.throwIfAborted() as never
      })
      await expect(saveRepoCopy(newCopy(NEW_COMMIT), update, { signal: controller.signal }, env)).rejects.toThrow()
      await readsInFull('old', OLD_COMMIT)
      expect(filesOf(NEW_COMMIT)).toEqual([])
    })

    it('when there’s no room', async () => {
      const cache = await storage.open(REPOS_CACHE)
      const put = cache.put.bind(cache)
      let puts = 0
      cache.put = async (request, response) => {
        if (++puts > 1) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
        return put(request, response)
      }
      await expect(saveRepoCopy(newCopy(NEW_COMMIT), batchesOf('new'), {}, env)).rejects.toThrow('quota')
      cache.put = put
      await readsInFull('old', OLD_COMMIT)
      expect(filesOf(NEW_COMMIT)).toEqual([])
    })

    it('when the tab closes, and the sweep then deletes what it left', async () => {
      const cache = await storage.open(REPOS_CACHE)
      for (const path of REPO_FILES.slice(0, 2))
        await cache.put(repoFileUrl(REPO_ID, NEW_COMMIT, path), Response.json(repoFile(path, 'new')))
      await readsInFull('old', OLD_COMMIT)
      await sweepRepoOrphans(env)
      await readsInFull('old', OLD_COMMIT)
      expect(filesOf(NEW_COMMIT)).toEqual([])
    })
  })

  it('writes the same commit over in place, and keeps it when that fails', async () => {
    await saveRepoCopy(newCopy(OLD_COMMIT), batchesOf('old'), {}, env)
    const again = failingAfterOne(() => {
      throw new TypeError('Failed to fetch')
    })
    await expect(saveRepoCopy(newCopy(OLD_COMMIT), again, {}, env)).rejects.toThrow()
    expect((await readRepoCopy(REPO_ID, env))?.commit).toBe(OLD_COMMIT)
    expect(filesOf(OLD_COMMIT)).toHaveLength(REPO_FILES.length)
  })

  it('refuses without Cache Storage', async () => {
    await expect(saveRepoCopy(newCopy(), batchesOf(), {}, { ...env, caches: null })).rejects.toThrow('not available')
  })
})

describe('reading', () => {
  it('lists copies newest first', async () => {
    const other = '0f8fad5b-d9cb-469f-a165-70867728950e'
    await saveRepoCopy(newCopy(), batchesOf(), {}, env)
    now += 10
    await saveRepoCopy(newCopy(OLD_COMMIT, { id: other, repo: repoView({ id: other }) }), batchesOf(), {}, env)
    expect((await listRepoCopies(env)).map((c) => [c.id, c.savedAt])).toEqual([
      [other, now],
      [REPO_ID, now - 10],
    ])
  })

  it('lists, reads and never creates the cache when nothing is saved', async () => {
    expect(await listRepoCopies(env)).toEqual([])
    expect(await readRepoCopy(REPO_ID, env)).toBeNull()
    expect(await readRepoFile({ id: REPO_ID, commit: OLD_COMMIT }, 'README.md', env)).toBeNull()
    expect(await storage.keys()).toEqual([])
  })

  it('ignores a malformed entry or file, and an entry without its summary', async () => {
    const cache = await storage.open(REPOS_CACHE)
    await cache.put(repoCopyUrl(REPO_ID), new Response('not json'))
    await cache.put(repoFileUrl(REPO_ID, OLD_COMMIT, 'README.md'), Response.json({ path: 'README.md' }))
    await cache.put(repoFileUrl(REPO_ID, OLD_COMMIT, 'logo.png'), new Response('{'))
    expect(await readRepoCopy(REPO_ID, env)).toBeNull()
    expect(await listRepoCopies(env)).toEqual([])
    expect(await readRepoFile({ id: REPO_ID, commit: OLD_COMMIT }, 'README.md', env)).toBeNull()
    expect(await readRepoFile({ id: REPO_ID, commit: OLD_COMMIT }, 'logo.png', env)).toBeNull()
    await cache.put(repoFileUrl(REPO_ID, OLD_COMMIT, 'docs/guide.ts'), Response.json(repoFile('README.md')))
    expect(await readRepoFile({ id: REPO_ID, commit: OLD_COMMIT }, 'docs/guide.ts', env)).toBeNull()
  })
})

describe('removeRepoCopy and the sweep', () => {
  it('removing the last download of either kind drops the caches and the app files, and not before', async () => {
    await storage.open(`${APP_CACHE_PREFIX}aaaaaaaaaaaa`)
    await saveRepoCopy(newCopy(), batchesOf(), {}, env)
    await saveBook(catalogueCopy(), {}, env)
    await removeRepoCopy(REPO_ID, env)
    expect(await readRepoCopy(REPO_ID, env)).toBeNull()
    expect(await storage.has(`${APP_CACHE_PREFIX}aaaaaaaaaaaa`)).toBe(true)
    expect(await hasDownloads(env)).toBe(true)
  })

  it('deletes keys no copy points to, and keys it doesn’t know', async () => {
    await saveRepoCopy(newCopy(), batchesOf(), {}, env)
    const cache = await storage.open(REPOS_CACHE)
    const other = '0f8fad5b-d9cb-469f-a165-70867728950e'
    await cache.put(repoFileUrl(other, OLD_COMMIT, 'README.md'), Response.json(repoFile('README.md')))
    await cache.put('/offline-repos/stray.txt', new Response('x'))
    await sweepRepoOrphans(env)
    expect(
      repos()
        ?.paths()
        .every((p) => p.startsWith(`/offline-repos/${REPO_ID}`)),
    ).toBe(true)
    await readsInFull('old', OLD_COMMIT)
  })

  it('a sweep with no copies left drops the repositories cache', async () => {
    const cache = await storage.open(REPOS_CACHE)
    await cache.put(repoFileUrl(REPO_ID, OLD_COMMIT, 'README.md'), Response.json(repoFile('README.md')))
    await sweepRepoOrphans(env)
    expect(await storage.has(REPOS_CACHE)).toBe(false)
  })
})
