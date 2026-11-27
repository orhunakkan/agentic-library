import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import type { DownloadOptions, DownloadResult } from '~/client/features/offline/download'
import { APP_CACHE_PREFIX, BOOKS_CACHE, CHECKED_KEY } from '~/client/features/offline/store'
import { useDownload } from '~/client/features/offline/use-download'
import { offlineBookUrl } from '~/shared/offline/book'
import { encodeSummary, type OfflineSummary, SUMMARY_HEADER } from '~/shared/offline/summary'
import { catalogueCopy } from '../../../../fixtures/offline-books'
import { mountHookAt, type TestRouteContext } from '../../../../support/client/router'

/**
 * Downloading fetches the app's files and the book's into Cache Storage; that pipeline is `download.ts`'s, and its own
 * tests cover it. It saves each file with `Cache.add`, which fetches on its own rather than through `fetch`, so a
 * stubbed `fetch` can't answer or hold those requests. Here it is a stand-in each test drives, while the list of
 * downloads and removing one run for real against Chromium's Cache Storage, which a test can hold back to answer late.
 */
const downloads = vi.hoisted(() => ({ downloadBook: vi.fn() }))
vi.mock('~/client/features/offline/download', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/client/features/offline/download')>()),
  downloadBook: downloads.downloadBook,
}))

const SIGNED_IN: TestRouteContext = { viewer: { username: 'ada' } }
const NAV = { stats: 1 }

interface Props {
  slug: string
  nav: unknown
}
const useDownloadOf = ({ slug, nav }: Props) => useDownload(slug, nav)

const summaryOf = (slug: string, bytes: number): OfflineSummary => ({
  slug,
  title: 'Essays',
  author: 'Anon',
  owner: null,
  bytes,
  savedAt: 1,
  start: `/read/${slug}`,
})

/** Keeps `slug` in the books cache the way a finished download leaves it, with `bytes` in its summary. */
async function keepDownloaded(slug: string, bytes: number) {
  const cache = await caches.open(BOOKS_CACHE)
  const summary = encodeSummary(summaryOf(slug, bytes))
  await cache.put(
    offlineBookUrl(slug),
    new Response('{}', { headers: { 'content-type': 'application/json', [SUMMARY_HEADER]: summary } }),
  )
}

/** A download the test finishes by hand, after seeing what the hook passed it. */
function heldDownload() {
  let finish: (result: DownloadResult) => void = () => {}
  let options: DownloadOptions = {}
  downloads.downloadBook.mockImplementation((_slug: string, given: DownloadOptions) => {
    options = given
    return new Promise<DownloadResult>((resolve) => {
      finish = resolve
    })
  })
  return { finish: (result: DownloadResult) => finish(result), options: () => options }
}

async function clearCaches() {
  for (const name of await caches.keys())
    if (name === BOOKS_CACHE || name.startsWith(APP_CACHE_PREFIX)) await caches.delete(name)
  localStorage.removeItem(CHECKED_KEY)
}

describe('useDownload', () => {
  beforeEach(async () => {
    downloads.downloadBook.mockReset()
    await clearCaches()
  })

  it('starts unavailable, then offers the download for a book not kept on this device', async () => {
    const hook = await mountHookAt('/books/essays', useDownloadOf, { slug: 'essays', nav: NAV }, { context: SIGNED_IN })
    expect(hook.current.state).toEqual({ kind: 'unavailable' })
    await expect.poll(() => hook.current.state).toEqual({ kind: 'idle' })
  })

  it('shows a book already kept on this device as downloaded, with its size', async () => {
    await keepDownloaded('essays', 4_096)
    const hook = await mountHookAt('/books/essays', useDownloadOf, { slug: 'essays', nav: NAV }, { context: SIGNED_IN })
    await expect.poll(() => hook.current.state).toEqual({ kind: 'downloaded', bytes: 4_096 })
  })

  it('stays unavailable on an embedded page', async () => {
    document.documentElement.dataset.embed = 'on'
    onTestFinished(() => {
      delete document.documentElement.dataset.embed
    })
    const looked = vi.spyOn(caches, 'has')
    const hook = await mountHookAt('/books/essays', useDownloadOf, { slug: 'essays', nav: NAV }, { context: SIGNED_IN })
    expect(looked).not.toHaveBeenCalled()
    expect(hook.current.state).toEqual({ kind: 'unavailable' })
  })

  it('reads the list again for a new book', async () => {
    await keepDownloaded('poems', 2_048)
    const hook = await mountHookAt('/books/essays', useDownloadOf, { slug: 'essays', nav: NAV }, { context: SIGNED_IN })
    await expect.poll(() => hook.current.state).toEqual({ kind: 'idle' })
    hook.rerender({ slug: 'poems', nav: NAV })
    await expect.poll(() => hook.current.state).toEqual({ kind: 'downloaded', bytes: 2_048 })
  })

  it('reports progress while downloading, then shows the book as downloaded', async () => {
    const held = heldDownload()
    const hook = await mountHookAt('/books/essays', useDownloadOf, { slug: 'essays', nav: NAV }, { context: SIGNED_IN })
    await expect.poll(() => hook.current.state).toEqual({ kind: 'idle' })
    const result = hook.current.download()
    await expect.poll(() => hook.current.state).toEqual({ kind: 'downloading', percent: 0 })
    expect(downloads.downloadBook).toHaveBeenCalledExactlyOnceWith('essays', expect.objectContaining({ nav: NAV }))
    held.options().onProgress?.(40)
    await expect.poll(() => hook.current.state).toEqual({ kind: 'downloading', percent: 40 })
    const book = catalogueCopy({ bytes: 9_000 })
    held.finish({ result: 'ok', book })
    await expect(result).resolves.toEqual({ result: 'ok', book })
    await expect.poll(() => hook.current.state).toEqual({ kind: 'downloaded', bytes: 9_000 })
  })

  it('offers the download again when it fails', async () => {
    const held = heldDownload()
    const hook = await mountHookAt('/books/essays', useDownloadOf, { slug: 'essays', nav: NAV }, { context: SIGNED_IN })
    await expect.poll(() => hook.current.state).toEqual({ kind: 'idle' })
    const result = hook.current.download()
    await expect.poll(() => hook.current.state.kind).toBe('downloading')
    held.finish({ result: 'no_room', bytes: 9_000 })
    await expect(result).resolves.toEqual({ result: 'no_room', bytes: 9_000 })
    await expect.poll(() => hook.current.state).toEqual({ kind: 'idle' })
  })

  it('cancels the download it started', async () => {
    const held = heldDownload()
    const hook = await mountHookAt('/books/essays', useDownloadOf, { slug: 'essays', nav: NAV }, { context: SIGNED_IN })
    await expect.poll(() => hook.current.state).toEqual({ kind: 'idle' })
    const result = hook.current.download()
    const signal = held.options().signal
    expect(signal?.aborted).toBe(false)
    hook.current.cancel()
    expect(signal?.aborted).toBe(true)
    held.finish({ result: 'cancelled' })
    await expect(result).resolves.toEqual({ result: 'cancelled' })
    await expect.poll(() => hook.current.state).toEqual({ kind: 'idle' })
  })

  it('removes the kept copy from this device', async () => {
    await keepDownloaded('essays', 4_096)
    const hook = await mountHookAt('/books/essays', useDownloadOf, { slug: 'essays', nav: NAV }, { context: SIGNED_IN })
    await expect.poll(() => hook.current.state.kind).toBe('downloaded')
    await hook.current.remove()
    await expect.poll(() => hook.current.state).toEqual({ kind: 'idle' })
    expect(await caches.has(BOOKS_CACHE)).toBe(false)
  })

  it('ignores the list for the previous book when it answers after the book changed', async () => {
    await keepDownloaded('essays', 4_096)
    /** The first look in Cache Storage, for the first book, answers only when the test says. */
    const late = Promise.withResolvers<boolean>()
    vi.spyOn(caches, 'has').mockReturnValueOnce(late.promise)
    const read = vi.spyOn(Cache.prototype, 'match')
    const hook = await mountHookAt('/books/essays', useDownloadOf, { slug: 'essays', nav: NAV }, { context: SIGNED_IN })
    hook.rerender({ slug: 'poems', nav: NAV })
    await expect.poll(() => hook.current.state).toEqual({ kind: 'idle' })
    const readsBefore = read.mock.calls.length
    late.resolve(true)
    /** The late list finds the first book's copy once it reads that entry; the next task sees what it answered. */
    await vi.waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(readsBefore))
    await read.mock.results[readsBefore]?.value
    await new Promise((resolve) => setTimeout(resolve, 0))
    /** Rendering again at once flushes any state the late answer set, so the check below sees it. */
    hook.rerender({ slug: 'poems', nav: NAV })
    expect(hook.current.state).toEqual({ kind: 'idle' })
  })
})
