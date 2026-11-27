import { beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { ToastProvider } from '~/client/components/Toast'
import { RepoDownload } from '~/client/features/github-repos/RepoDownload'
import { readRepoCopy, readRepoFile } from '~/client/features/offline/repo-store'
import { APP_CACHE_PREFIX, BOOKS_CACHE } from '~/client/features/offline/store'
import type { RepoView } from '~/shared/github-repos/contract'
import {
  MAX_OFFLINE_BYTES,
  MAX_OFFLINE_FILES,
  type RepoOfflineBatch,
  type RepoOfflineBatchBody,
  type RepoOfflinePlan,
  type RepoOfflineRefusal,
} from '~/shared/github-repos/offline'
import { REPOS_CACHE } from '~/shared/offline/repo'
import { REPO_FILES, REPO_ID, repoFile, repoPlan, repoView } from '../../../../fixtures/offline-repos'
import { mountAt, type TestRouteContext } from '../../../../support/client/router'

const SIGNED_IN: TestRouteContext = { viewer: { username: 'ada' } }
const OFFLINE_URL = `/account/repos/${REPO_ID}/offline`
const MANIFEST = { build: 'bbbbbbbbbbbb', files: [] }

/** An answer of the offline route, shaped as `src/shared/github-repos/offline.ts` types it. */
const answer = (status: number, body: RepoOfflinePlan | RepoOfflineBatch | RepoOfflineRefusal) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

let fetchSpy: MockInstance<typeof fetch>

/**
 * The network: the app's files (none to fetch), the plan, and each batch rendered as the server would. A test can
 * swap the plan's answer, or hold the batches back to cancel while one is in flight.
 */
function serve({
  plan = () => answer(200, repoPlan()),
  batch = (body: RepoOfflineBatchBody): Promise<Response> | Response =>
    answer(200, { files: body.paths.map((p) => repoFile(p)) }),
} = {}) {
  fetchSpy.mockImplementation(async (input, init) => {
    const path = new URL(String(input), location.href).pathname
    if (path === '/app-files.json') return Response.json(MANIFEST)
    if (path !== OFFLINE_URL) throw new TypeError('Failed to fetch')
    if (init?.method !== 'POST') return plan()
    return batch(JSON.parse(String(init.body)) as RepoOfflineBatchBody)
  })
}

async function clearCaches() {
  for (const name of await caches.keys())
    if (name === REPOS_CACHE || name === BOOKS_CACHE || name.startsWith(APP_CACHE_PREFIX)) await caches.delete(name)
}

beforeEach(async () => {
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
  await clearCaches()
})

const mountControl = (repo: RepoView = repoView(), context = SIGNED_IN) =>
  mountAt(
    `/account/repos/${repo.id}`,
    <ToastProvider>
      <RepoDownload repo={repo} />
    </ToastProvider>,
    context,
  )

const downloadButton = page.getByRole('button', { name: 'Download for offline' })
const removeButton = page.getByRole('button', { name: 'Remove download' })
const cancelButton = page.getByRole('button', { name: 'Cancel' })

describe('RepoDownload', () => {
  it('downloads every file with progress, says so, and removes the download', async () => {
    serve()
    await mountControl()
    await expect.element(downloadButton).toBeVisible()
    await expect.element(page.getByTestId('repo-download-offline')).toHaveAccessibleName('Download for offline')
    await userEvent.click(downloadButton)
    /** The done line and the note are plain text, with no role of their own. */
    const done = page.getByTestId('repo-download-done')
    await expect.poll(() => done.query()?.textContent).toMatch(/^Downloaded · [0-9]+ KB$/)
    await expect.element(page.getByTestId('repo-download-note')).toHaveTextContent('Removed when you sign out.')
    await expect.element(page.getByText('Downloaded for offline reading.')).toBeVisible()
    await expect.element(removeButton).toHaveFocus()
    const copy = await readRepoCopy(REPO_ID)
    expect(copy).toMatchObject({ account: 'ada', commit: repoView().commit })
    for (const path of REPO_FILES) expect(copy && (await readRepoFile(copy, path))).toEqual(repoFile(path))

    await userEvent.click(removeButton)
    await expect.element(downloadButton).toHaveFocus()
    await expect.element(page.getByText('Download removed.')).toBeVisible()
    expect(await readRepoCopy(REPO_ID)).toBeNull()
    expect(await caches.has(REPOS_CACHE)).toBe(false)
  })

  it('shows a download already kept on this device', async () => {
    serve()
    await mountControl()
    await userEvent.click(downloadButton)
    await expect.element(removeButton).toBeVisible()
    document.body.replaceChildren()
    await mountControl()
    await expect.element(removeButton).toBeVisible()
  })

  it('shows progress while a batch is in flight, and Cancel leaves nothing saved', async () => {
    let release: (response: Response) => void = () => {}
    serve({ batch: () => new Promise<Response>((resolve) => (release = resolve)) })
    await mountControl()
    await userEvent.click(downloadButton)
    const progress = page.getByRole('progressbar', { name: 'Downloading folio-test/sample' })
    await expect.element(progress).toBeVisible()
    const percent = page.getByTestId('repo-download-progress')
    await expect.poll(() => percent.query()?.textContent).toMatch(/^Downloading… [0-9]+%$/)
    await expect.element(cancelButton).toHaveFocus()
    await userEvent.click(cancelButton)
    release(answer(200, { files: REPO_FILES.map((p) => repoFile(p)) }))
    await expect.element(downloadButton).toHaveFocus()
    expect(page.getByTestId('repo-download-problem').query()).toBeNull()
    expect(await readRepoCopy(REPO_ID)).toBeNull()
  })

  it('says a repository is too big to download, with the numbers', async () => {
    serve({
      plan: () =>
        answer(413, {
          error: 'too_large',
          files: 2400,
          bytes: 30 * 1024 * 1024,
          maxFiles: MAX_OFFLINE_FILES,
          maxBytes: MAX_OFFLINE_BYTES,
        }),
    })
    await mountControl()
    await userEvent.click(downloadButton)
    const problem = page.getByTestId('repo-download-problem')
    await expect.element(problem).toHaveRole('status')
    await expect
      .element(problem)
      .toHaveTextContent(
        'This repository is too big to download: 2,400 files, 30 MB of source. Downloads hold up to 2,000 files and 20 MB of source.',
      )
    await expect.element(downloadButton).toBeVisible()
    expect(await caches.has(REPOS_CACHE)).toBe(false)
  })

  it('says a download failed, and tries again from the same button', async () => {
    serve({ plan: () => answer(502, { error: 'unavailable' }) })
    await mountControl()
    await userEvent.click(downloadButton)
    const problem = page.getByTestId('repo-download-problem')
    await expect.element(problem).toHaveRole('alert')
    await expect
      .element(problem)
      .toHaveTextContent('Couldn’t download this repository. Check your connection and try again.')
    serve()
    await userEvent.click(downloadButton)
    await expect.element(removeButton).toBeVisible()
    expect(problem.query()).toBeNull()
  })

  it('isn’t offered when no one is signed in', async () => {
    serve()
    await mountControl(repoView(), { viewer: null })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(downloadButton.query()).toBeNull()
  })
})
