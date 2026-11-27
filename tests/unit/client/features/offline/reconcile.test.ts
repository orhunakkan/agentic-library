import { beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetGoneCopy, forgetUnlistedCopies, reconcileDownloads } from '~/client/features/offline/reconcile'
import { readRepoCopy, saveRepoCopy } from '~/client/features/offline/repo-store'
import { type OfflineEnv, readChecked, readCopy, saveBook } from '~/client/features/offline/store'
import { REPOS_CACHE, repoFileUrl } from '~/shared/offline/repo'
import { FakeCacheStorage, memoryStorage } from '../../../../fixtures/cache-storage'
import { catalogueCopy, fileServer, PRIVATE_ID, PRIVATE_SLUG, privateCopy } from '../../../../fixtures/offline-books'
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
const deps = () => ({ refreshAppCache: vi.fn(async () => {}) })

beforeEach(async () => {
  storage = new FakeCacheStorage()
  storage.fetcher = fileServer().fetcher
  now = 1000
  env = { caches: storage.api, storage: memoryStorage(), now: () => now }
  await saveBook(catalogueCopy(), {}, env)
  await saveBook(privateCopy('ada'), {}, env)
})

const slugs = async () => [(await readCopy('essays', env))?.slug, (await readCopy(PRIVATE_SLUG, env))?.slug]

describe('reconcileDownloads', () => {
  it('signed out, deletes private copies and keeps the catalogue’s, then refreshes the app files', async () => {
    const d = deps()
    await reconcileDownloads(null, env, d)
    expect(await slugs()).toEqual(['essays', undefined])
    expect(d.refreshAppCache).toHaveBeenCalledOnce()
  })

  it('a null viewer from a database outage deletes them the same way', async () => {
    await reconcileDownloads(null, env, deps())
    expect(readChecked(env.storage)).toEqual({})
  })

  it('signed in as someone else, deletes the other username’s copies', async () => {
    await reconcileDownloads({ username: 'bob' }, env, deps())
    expect(await slugs()).toEqual(['essays', undefined])
  })

  it('signed in as the owner, keeps them and stamps them as confirmed', async () => {
    now = 9000
    await reconcileDownloads({ username: 'ada' }, env, deps())
    expect(await slugs()).toEqual(['essays', PRIVATE_SLUG])
    expect(readChecked(env.storage)).toEqual({ [PRIVATE_SLUG]: 9000 })
  })

  it('deletes the files a tab closed partway through a repository update left, and keeps the copy', async () => {
    async function* files() {
      yield REPO_FILES.map((p) => repoFile(p))
    }
    const copy = { id: REPO_ID, account: 'ada', repo: repoView(), folders: REPO_FOLDERS, files: REPO_FILES }
    await saveRepoCopy(copy, files(), {}, env)
    const repos = await storage.open(REPOS_CACHE)
    await repos.put(repoFileUrl(REPO_ID, NEW_COMMIT, 'README.md'), Response.json(repoFile('README.md', 'new')))
    await reconcileDownloads({ username: 'ada' }, env, deps())
    expect(repos.paths().some((p) => p.includes(NEW_COMMIT))).toBe(false)
    expect((await readRepoCopy(REPO_ID, env))?.commit).toBe(OLD_COMMIT)
  })

  it('swallows a failure, and does nothing without Cache Storage', async () => {
    const failing = { refreshAppCache: vi.fn(async () => Promise.reject(new Error('offline'))) }
    await expect(reconcileDownloads({ username: 'ada' }, env, failing)).resolves.toBeUndefined()
    const d = deps()
    await reconcileDownloads(null, { ...env, caches: null }, d)
    expect(d.refreshAppCache).not.toHaveBeenCalled()
  })
})

describe('forgetGoneCopy and forgetUnlistedCopies', () => {
  it('delete a private copy the server says is gone, never a catalogue one', async () => {
    await forgetGoneCopy('essays', env)
    await forgetGoneCopy(PRIVATE_SLUG, env)
    expect(await slugs()).toEqual(['essays', undefined])
  })

  it('keep the private copies My books lists, and delete the rest', async () => {
    await forgetUnlistedCopies([PRIVATE_ID], env)
    expect(await slugs()).toEqual(['essays', PRIVATE_SLUG])
    await forgetUnlistedCopies([], env)
    expect(await slugs()).toEqual(['essays', undefined])
    await expect(forgetUnlistedCopies([], { ...env, caches: null })).resolves.toBeUndefined()
  })
})
