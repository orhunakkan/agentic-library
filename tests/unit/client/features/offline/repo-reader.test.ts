import { beforeEach, describe, expect, it } from 'vitest'
import {
  isRepoOfflineMissing,
  RepoOfflineMissing,
  reposFromCopies,
  repoViewFromCopy,
} from '~/client/features/offline/repo-reader'
import { readRepoCopy, saveRepoCopy } from '~/client/features/offline/repo-store'
import { CHECK_WINDOW_MS, type OfflineEnv } from '~/client/features/offline/store'
import type { RepoFile } from '~/shared/github-repos/contract'
import { REPOS_CACHE, repoFileUrl } from '~/shared/offline/repo'
import { FakeCacheStorage, memoryStorage } from '../../../../fixtures/cache-storage'
import { OLD_COMMIT, REPO_FILES, REPO_FOLDERS, REPO_ID, repoFile, repoView } from '../../../../fixtures/offline-repos'

let storage: FakeCacheStorage
let env: OfflineEnv
let now: number

beforeEach(async () => {
  storage = new FakeCacheStorage()
  now = 1000
  env = { caches: storage.api, storage: memoryStorage(), now: () => now }
})

async function keepCopy(files: readonly string[] = REPO_FILES) {
  async function* batches(): AsyncGenerator<RepoFile[]> {
    yield files.map((p) => repoFile(p))
  }
  await saveRepoCopy(
    { id: REPO_ID, account: 'ada', repo: repoView(), folders: REPO_FOLDERS, files },
    batches(),
    {},
    env,
  )
}

const folders = REPO_FOLDERS.map(({ path, entries }) => ({ path, entries }))
const readmeContent = repoFile('README.md').content
const readmeMarkdown =
  readmeContent.kind === 'markdown' && readmeContent.view === 'preview' ? readmeContent.markdown : null

describe('repoViewFromCopy', () => {
  it('puts a folder together from the copy’s entries and its README’s preview, with every folder for the tree', async () => {
    await keepCopy()
    expect(await repoViewFromCopy(REPO_ID, '', env)).toEqual({
      state: 'ready',
      repo: repoView(),
      folders,
      target: {
        kind: 'folder',
        folder: {
          path: '',
          entries: REPO_FOLDERS[0]?.entries,
          readme: { path: 'README.md', markdown: readmeMarkdown },
        },
      },
      refreshed: null,
      offline: true,
    })
    const docs = await repoViewFromCopy(REPO_ID, 'docs', env)
    expect(docs.target).toEqual({
      kind: 'folder',
      folder: { path: 'docs', entries: REPO_FOLDERS[1]?.entries, readme: null },
    })
  })

  it('opens a file from its saved entry, a picture as a picture', async () => {
    await keepCopy()
    expect((await repoViewFromCopy(REPO_ID, 'docs/guide.ts', env)).target).toEqual({
      kind: 'file',
      file: repoFile('docs/guide.ts'),
    })
    expect((await repoViewFromCopy(REPO_ID, 'logo.png', env)).target).toEqual({
      kind: 'file',
      file: repoFile('logo.png'),
    })
  })

  it('answers missing for a path the copy doesn’t hold, or whose file isn’t saved', async () => {
    await keepCopy()
    expect((await repoViewFromCopy(REPO_ID, 'nowhere.md', env)).target).toEqual({ kind: 'missing' })
    expect((await repoViewFromCopy(REPO_ID, 'docs/nowhere', env)).target).toEqual({ kind: 'missing' })
    await (await storage.open(REPOS_CACHE)).delete(repoFileUrl(REPO_ID, OLD_COMMIT, 'docs/guide.ts'))
    expect((await repoViewFromCopy(REPO_ID, 'docs/guide.ts', env)).target).toEqual({ kind: 'missing' })
  })

  it('shows a folder without its README when the README’s file isn’t saved', async () => {
    await keepCopy(['logo.png', 'docs/guide.ts'])
    expect((await repoViewFromCopy(REPO_ID, '', env)).target).toMatchObject({
      kind: 'folder',
      folder: { readme: null },
    })
  })

  it('won’t open a copy unchecked for more than 30 days, and deletes it', async () => {
    await keepCopy()
    now += CHECK_WINDOW_MS
    expect((await repoViewFromCopy(REPO_ID, '', env)).offline).toBe(true)
    now += 1
    await expect(repoViewFromCopy(REPO_ID, '', env)).rejects.toBeInstanceOf(RepoOfflineMissing)
    expect(await readRepoCopy(REPO_ID, env)).toBeNull()
  })

  it('throws RepoOfflineMissing when this device has no copy', async () => {
    const opening = repoViewFromCopy(REPO_ID, '', env)
    await expect(opening).rejects.toBeInstanceOf(RepoOfflineMissing)
    const error = await opening.catch((e: unknown) => e)
    expect(isRepoOfflineMissing(error)).toBe(true)
    expect(isRepoOfflineMissing(new Error('other'))).toBe(false)
  })
})

describe('reposFromCopies', () => {
  it('lists the copies that may open, newest first, as the list page’s ready state', async () => {
    expect(await reposFromCopies(env)).toEqual({ state: 'ready', repos: [], offline: true })
    await keepCopy()
    expect(await reposFromCopies(env)).toEqual({ state: 'ready', repos: [repoView()], offline: true })
    now += CHECK_WINDOW_MS + 1
    expect(await reposFromCopies(env)).toEqual({ state: 'ready', repos: [], offline: true })
  })
})
