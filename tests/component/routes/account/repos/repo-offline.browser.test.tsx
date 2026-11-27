import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { readRepoCopy, saveRepoCopy } from '~/client/features/offline/repo-store'
import { APP_CACHE_PREFIX, BOOKS_CACHE } from '~/client/features/offline/store'
import { Route } from '~/routes/account/repos/$id/index'
import { Route as ReposRoute } from '~/routes/account/repos/index'
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
  getRepoView: vi.fn(async (): Promise<unknown> => Promise.reject(new TypeError('Failed to fetch'))),
  getRepoFolder: vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
  getRepos: vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
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

/** Keeps the copy, with `pictures` saved as the raw route would answer them. */
async function keepCopy(pictures: string[] = []) {
  async function* batches() {
    yield FILES
  }
  const fetch = async () =>
    new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } })
  await saveRepoCopy(
    { id: REPO_ID, account: 'ada', repo: repoView(), folders: FOLDERS, files: FILES.map((f) => f.path) },
    batches(),
    { pictures: { paths: pictures, fetch } },
  )
}

beforeEach(async () => {
  server.getRepoFolder.mockClear()
  server.getRepoView.mockImplementation(async () => Promise.reject(new TypeError('Failed to fetch')))
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

  it('shows the pictures the copy kept, from the raw route the service worker answers offline', async () => {
    await keepCopy(['logo.png'])
    await openOffline()
    const readme = page.getByRole('region', { name: 'README.md' })
    const logo = readme.getByRole('img', { name: 'The logo' })
    await expect.element(logo).toHaveAttribute('src', `/account/repos/${REPO_ID}/raw?path=logo.png`)
    expect(readme.getByTestId('repo-offline-picture').query()).toBeNull()
    document.body.replaceChildren()
    await openOffline('?path=logo.png')
    await expect.element(page.getByRole('img', { name: 'logo.png' })).toBeVisible()
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

describe('the repositories list offline', () => {
  const openList = () =>
    mountRoute(ReposRoute, '/account/repos', { sourceUrl: null }, { context: { viewer: null, offline: true } })

  it('lists the downloaded copies, with an offline note and no add or remove controls', async () => {
    await keepCopy()
    await openList()
    await expect
      .element(page.getByRole('status'))
      .toHaveTextContent('You’re offline. These repositories are downloaded on this device.')
    await expect.element(page.getByRole('link', { name: 'folio-test/sample' })).toBeVisible()
    expect(page.getByRole('textbox', { name: 'Repository address' }).query()).toBeNull()
    expect(page.getByRole('button', { name: 'Remove' }).query()).toBeNull()
    expect(page.getByRole('button', { name: 'Refresh' }).query()).toBeNull()
  })

  it('says when no repository is downloaded', async () => {
    await openList()
    /** The empty line is plain text, with no role of its own. */
    await expect
      .element(page.getByTestId('repos-empty'))
      .toHaveTextContent('No repository is downloaded on this device.')
  })
})

describe('the repository page online', () => {
  it('deletes this device’s copy when the server says the account has no such repository', async () => {
    await keepCopy()
    server.getRepoView.mockImplementation(async () => ({ state: 'not_found' }))
    await mountRoute(
      Route,
      '/account/repos/$id',
      { sourceUrl: null },
      {
        url: `/account/repos/${REPO_ID}`,
        context: { viewer: { username: 'ada' } },
      },
    )
    await expect.poll(() => readRepoCopy(REPO_ID)).toBeNull()
  })
})
