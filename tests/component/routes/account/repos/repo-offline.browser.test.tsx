import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { saveRepoCopy } from '~/client/features/offline/repo-store'
import { APP_CACHE_PREFIX, BOOKS_CACHE } from '~/client/features/offline/store'
import { Route } from '~/routes/account/repos/$id/index'
import type { RepoFile } from '~/shared/github-repos/contract'
import type { RepoOfflineFolder } from '~/shared/github-repos/offline'
import { REPOS_CACHE } from '~/shared/offline/repo'
import { REPO_ID, repoFile, repoView } from '../../../../fixtures/offline-repos'
import { mountRoute } from '../../../../support/client/router'

/**
 * Offline, the page's server function fails as a fetch does with no network, and the page is put together from the
 * copy kept for real in Chromium's Cache Storage. Opening a folder in the tree must never ask the server.
 */
const server = vi.hoisted(() => ({
  getRepoView: vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
  getRepoFolder: vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
}))
vi.mock('~/server/account-functions', () => server)
/** The route file also serves the page's POST; that handler is server code, which never runs in the browser. */
vi.mock('~/server/github-repos/actions', () => ({ handleRepoAction: vi.fn() }))

const FOLDERS: RepoOfflineFolder[] = [
  {
    path: '',
    entries: [
      { name: 'docs', path: 'docs', kind: 'folder', size: null },
      { name: 'logo.png', path: 'logo.png', kind: 'file', size: 300 },
      { name: 'README.md', path: 'README.md', kind: 'file', size: 40 },
    ],
    readme: 'README.md',
  },
  {
    path: 'docs',
    entries: [
      { name: 'deep', path: 'docs/deep', kind: 'folder', size: null },
      { name: 'guide.ts', path: 'docs/guide.ts', kind: 'file', size: 20 },
      { name: 'notes.md', path: 'docs/notes.md', kind: 'file', size: 30 },
    ],
    readme: null,
  },
  { path: 'docs/deep', entries: [{ name: 'a.ts', path: 'docs/deep/a.ts', kind: 'file', size: 5 }], readme: null },
]

/** The README, with a picture from the repository, which the copy can't show offline. */
const README: RepoFile = {
  path: 'README.md',
  name: 'README.md',
  size: 40,
  lines: 3,
  content: {
    kind: 'markdown',
    view: 'preview',
    markdown: {
      frontMatter: [],
      externalImages: 0,
      nodes: [
        { t: 'el', tag: 'p', c: [{ t: 'text', v: 'Welcome to the sample.' }] },
        { t: 'img', source: { kind: 'repo', path: 'logo.png' }, alt: 'The logo' },
      ],
    },
  },
}

const FILES = [
  README,
  repoFile('logo.png'),
  repoFile('docs/guide.ts'),
  repoFile('docs/notes.md'),
  repoFile('docs/deep/a.ts'),
]

async function keepCopy() {
  async function* batches() {
    yield FILES
  }
  await saveRepoCopy(
    { id: REPO_ID, account: 'ada', repo: repoView(), folders: FOLDERS, files: FILES.map((f) => f.path) },
    batches(),
  )
}

beforeEach(async () => {
  server.getRepoFolder.mockClear()
  for (const name of await caches.keys())
    if (name === REPOS_CACHE || name === BOOKS_CACHE || name.startsWith(APP_CACHE_PREFIX)) await caches.delete(name)
})

const openOffline = (query = '') =>
  mountRoute(
    Route,
    '/account/repos/$id',
    { sourceUrl: null },
    {
      url: `/account/repos/${REPO_ID}${query}`,
      context: { viewer: null, offline: true },
    },
  )

const main = page.getByRole('main')

describe('the repository page offline', () => {
  it('opens from the copy, with the Offline chip and none of the online controls', async () => {
    await keepCopy()
    await openOffline()
    await expect.element(page.getByRole('heading', { level: 1, name: 'folio-test/sample' })).toBeVisible()
    /** The chip is a plain label, with no role of its own. */
    await expect.element(page.getByTestId('repo-offline')).toHaveTextContent('Offline')
    const readme = page.getByRole('region', { name: 'README.md' })
    await expect.element(readme.getByText('Welcome to the sample.')).toBeVisible()
    await expect
      .element(readme.getByTestId('repo-offline-picture'))
      .toHaveTextContent('The logo (Pictures show when you’re back online)')
    expect(readme.getByRole('img').query()).toBeNull()
    expect(page.getByRole('button', { name: 'Refresh' }).query()).toBeNull()
    expect(page.getByRole('button', { name: 'Download for offline' }).query()).toBeNull()
  })

  it('browses a folder, a file and a folder deep in the tree without asking the server', async () => {
    await keepCopy()
    await openOffline()
    await userEvent.click(main.getByRole('link', { name: 'docs/' }).first())
    await expect.element(page.getByRole('link', { name: 'guide.ts' }).first()).toBeVisible()
    await userEvent.click(main.getByRole('link', { name: 'guide.ts' }).last())
    await expect.element(page.getByTestId('repo-file-info')).toHaveTextContent('guide.ts · 20 bytes · 1 line')
    await expect.element(page.getByTestId('repo-file')).toHaveTextContent("const v = 'old'")
    const tree = page.getByRole('complementary')
    await userEvent.click(tree.getByRole('button', { name: 'deep' }))
    await expect.element(tree.getByRole('link', { name: 'a.ts' })).toBeVisible()
    expect(server.getRepoFolder).not.toHaveBeenCalled()
  })

  it('shows Markdown as its preview with no Code view, and a picture’s place', async () => {
    await keepCopy()
    await openOffline('?path=docs%2Fnotes.md')
    await expect.element(page.getByTestId('repo-file')).toHaveTextContent('old')
    expect(page.getByRole('navigation', { name: 'View' }).query()).toBeNull()
    document.body.replaceChildren()
    await openOffline('?path=logo.png')
    await expect
      .element(page.getByTestId('repo-file-notice'))
      .toHaveTextContent('Pictures show when you’re back online.')
  })

  it('says a path the copy hasn’t is missing', async () => {
    await keepCopy()
    await openOffline('?path=nowhere.ts')
    await expect
      .element(page.getByTestId('repo-file-notice'))
      .toHaveTextContent('This file isn’t in the latest version. Back to the repository.')
  })

  it('says the repository isn’t downloaded when this device has no copy', async () => {
    /** The router warns of the loader's error, which is this page's whole point. */
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await openOffline()
    const title = page.getByTestId('repo-offline-title')
    await expect.element(title).toHaveRole('heading')
    await expect.element(title).toHaveAccessibleName('You’re offline')
    await expect.element(page.getByText('This repository isn’t downloaded on this device.')).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  })
})
