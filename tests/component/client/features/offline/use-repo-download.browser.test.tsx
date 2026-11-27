import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RepoDownloadOptions, RepoDownloadResult } from '~/client/features/offline/repo-download'
import { APP_CACHE_PREFIX, BOOKS_CACHE } from '~/client/features/offline/store'
import { useRepoDownload } from '~/client/features/offline/use-repo-download'
import {
  encodeRepoSummary,
  REPO_SUMMARY_HEADER,
  REPOS_CACHE,
  type RepoCopy,
  repoCopyUrl,
  summaryOf,
} from '~/shared/offline/repo'
import { OLD_COMMIT, REPO_FOLDERS, REPO_ID, repoView } from '../../../../fixtures/offline-repos'
import { mountHookAt, type TestRouteContext } from '../../../../support/client/router'

/**
 * The download pipeline is `repo-download.ts`'s, which its unit tests cover; here it is a stand-in each test drives,
 * while the list of copies and removing one run for real against Chromium's Cache Storage.
 */
const downloads = vi.hoisted(() => ({ downloadRepo: vi.fn() }))
vi.mock('~/client/features/offline/repo-download', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/client/features/offline/repo-download')>()),
  downloadRepo: downloads.downloadRepo,
}))

const SIGNED_IN: TestRouteContext = { viewer: { username: 'ada' } }
const NAV = { stats: 1 }

interface Props {
  id: string
}
const useDownloadOf = ({ id }: Props) => useRepoDownload(id, NAV)

const copyFor = (account: string, bytes = 4096): RepoCopy => ({
  v: 1,
  id: REPO_ID,
  account,
  repo: repoView(),
  folders: REPO_FOLDERS,
  commit: OLD_COMMIT,
  bytes,
  savedAt: 1,
  pictures: [],
  picturesSkipped: false,
})

/** Keeps a copy in the repositories cache the way a finished download leaves its entry. */
async function keepCopy(copy: RepoCopy) {
  const cache = await caches.open(REPOS_CACHE)
  await cache.put(
    repoCopyUrl(copy.id),
    new Response(JSON.stringify(copy), { headers: { [REPO_SUMMARY_HEADER]: encodeRepoSummary(summaryOf(copy)) } }),
  )
}

/** A download the test finishes by hand, after seeing what the hook passed it. */
function heldDownload() {
  let finish: (result: RepoDownloadResult) => void = () => {}
  let options: RepoDownloadOptions | null = null
  downloads.downloadRepo.mockImplementation((_id: string, given: RepoDownloadOptions) => {
    options = given
    return new Promise<RepoDownloadResult>((resolve) => {
      finish = resolve
    })
  })
  return { finish: (result: RepoDownloadResult) => finish(result), options: () => options }
}

beforeEach(async () => {
  downloads.downloadRepo.mockReset()
  for (const name of await caches.keys())
    if (name === REPOS_CACHE || name === BOOKS_CACHE || name.startsWith(APP_CACHE_PREFIX)) await caches.delete(name)
})

describe('useRepoDownload', () => {
  it('starts unavailable, then shows a copy this account kept, and offers one another account kept', async () => {
    await keepCopy(copyFor('ada'))
    const mine = await mountHookAt('/', useDownloadOf, { id: REPO_ID }, { context: SIGNED_IN })
    expect(mine.current.state).toEqual({ kind: 'unavailable' })
    await expect
      .poll(() => mine.current.state)
      .toEqual({ kind: 'downloaded', bytes: 4096, commit: OLD_COMMIT, picturesSkipped: false, problem: null })
    mine.unmount()
    await keepCopy(copyFor('grace'))
    const theirs = await mountHookAt('/', useDownloadOf, { id: REPO_ID }, { context: SIGNED_IN })
    await expect.poll(() => theirs.current.state).toEqual({ kind: 'idle', problem: null })
  })

  it('stays unavailable signed out, and downloads nothing', async () => {
    const hook = await mountHookAt('/', useDownloadOf, { id: REPO_ID }, { context: { viewer: null } })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(hook.current.state).toEqual({ kind: 'unavailable' })
    expect(await hook.current.download()).toBeNull()
    expect(downloads.downloadRepo).not.toHaveBeenCalled()
  })

  it('passes the account, the sidebar’s data and its signal, and Cancel aborts it', async () => {
    const held = heldDownload()
    const hook = await mountHookAt('/', useDownloadOf, { id: REPO_ID }, { context: SIGNED_IN })
    await expect.poll(() => hook.current.state.kind).toBe('idle')
    const running = hook.current.download()
    await expect.poll(() => hook.current.state).toEqual({ kind: 'downloading', percent: 0 })
    const options = held.options()
    expect(options).toMatchObject({ account: 'ada', nav: NAV })
    options?.onProgress?.(40)
    await expect.poll(() => hook.current.state).toEqual({ kind: 'downloading', percent: 40 })
    hook.current.cancel()
    expect(options?.signal?.aborted).toBe(true)
    held.finish({ result: 'cancelled' })
    await running
    await expect.poll(() => hook.current.state).toEqual({ kind: 'idle', problem: null })
  })

  it('keeps showing the copy it had when a download fails, with the problem', async () => {
    await keepCopy(copyFor('ada'))
    const held = heldDownload()
    const hook = await mountHookAt('/', useDownloadOf, { id: REPO_ID }, { context: SIGNED_IN })
    await expect.poll(() => hook.current.state.kind).toBe('downloaded')
    const running = hook.current.download()
    held.finish({ result: 'no_room', bytes: 9000 })
    await running
    await expect
      .poll(() => hook.current.state)
      .toEqual({
        kind: 'downloaded',
        bytes: 4096,
        commit: OLD_COMMIT,
        picturesSkipped: false,
        problem: { kind: 'no_room', bytes: 9000 },
      })
  })

  it('drops an answer that arrives after it unmounts', async () => {
    const held = heldDownload()
    const hook = await mountHookAt('/', useDownloadOf, { id: REPO_ID }, { context: SIGNED_IN })
    await expect.poll(() => hook.current.state.kind).toBe('idle')
    const running = hook.current.download()
    hook.unmount()
    held.finish({ result: 'failed' })
    expect(await running).toEqual({ result: 'failed' })
    /** Its last render before unmounting, not the failure that came after. */
    expect(hook.current.state).toEqual({ kind: 'idle', problem: null })
  })
})
